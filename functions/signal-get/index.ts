import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { Signal, Interpretation, Claim } from '../shared/entities';
import { ClarificationRequest } from '../shared/entities/clarification';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET = process.env.SIGNALS_BUCKET!;
const TABLE = process.env.SIGNALS_TABLE!;

interface EventCandidate {
  candidateId: string;
  clarificationIds?: string[];
}

interface SignalResponse {
  signal: Signal;
  interpretation?: Interpretation;
  claims: Claim[];
  clarifications: ClarificationRequest[];
  rawContentUrl?: string;
}

// Fetch clarifications directly linked to signal via GSI2
async function getClarificationsBySignal(signalId: string): Promise<ClarificationRequest[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SIGNAL#${signalId}`,
        ':sk': 'CLAR#',
      },
    })
  );

  const clarifications = (result.Items ?? []) as ClarificationRequest[];
  return clarifications.filter((c) => c.status === 'open');
}

// Fetch clarifications from event candidates (legacy path - via clarificationIds on candidates)
async function getClarificationsFromCandidates(candidateIds: string[]): Promise<ClarificationRequest[]> {
  if (candidateIds.length === 0) return [];

  // Batch get candidates
  const candidateKeys = candidateIds.map((id) => ({
    PK: `CANDIDATE#${id}`,
    SK: '#METADATA',
  }));

  const candidatesResult = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [TABLE]: { Keys: candidateKeys },
      },
    })
  );

  const candidates = (candidatesResult.Responses?.[TABLE] || []) as EventCandidate[];

  // Collect all clarificationIds from candidates
  const clarificationIds: string[] = [];
  for (const candidate of candidates) {
    if (candidate.clarificationIds && candidate.clarificationIds.length > 0) {
      clarificationIds.push(...candidate.clarificationIds);
    }
  }

  if (clarificationIds.length === 0) return [];

  // Batch get clarifications
  const clarificationKeys = clarificationIds.map((id) => ({
    PK: `CLAR#${id}`,
    SK: '#METADATA',
  }));

  const clarificationsResult = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [TABLE]: { Keys: clarificationKeys },
      },
    })
  );

  const allClarifications = (clarificationsResult.Responses?.[TABLE] || []) as ClarificationRequest[];

  // Filter to only return open clarifications
  return allClarifications.filter((c) => c.status === 'open');
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const signalId = event.pathParameters?.signalId;

    if (!signalId) {
      return response(400, { error: 'Missing signalId parameter' });
    }

    // Validate signalId format
    if (!/^sgnl_[a-zA-Z0-9]{8}$/.test(signalId)) {
      return response(400, { error: 'Invalid signalId format' });
    }

    // Get signal metadata
    const signalResult = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `SIGNAL#${signalId}`, SK: '#METADATA' },
      })
    );

    if (!signalResult.Item) {
      return response(404, { error: 'Signal not found' });
    }

    const signal = signalResult.Item as Signal;

    // Get current interpretation if exists
    let interpretation: Interpretation | undefined;
    if (signal.currentInterpretationId) {
      const intpResult = await ddb.send(
        new GetCommand({
          TableName: TABLE,
          Key: { PK: `INTP#${signal.currentInterpretationId}`, SK: '#METADATA' },
        })
      );
      interpretation = intpResult.Item as Interpretation | undefined;
    }

    // Get claims for this signal
    const claimsResult = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `SIGNAL#${signalId}`,
        },
      })
    );

    const claims = (claimsResult.Items ?? []) as Claim[];

    // Get clarifications - both directly linked to signal and via candidates
    const [directClarifications, candidateClarifications] = await Promise.all([
      getClarificationsBySignal(signalId),
      interpretation?.eventCandidateIds && interpretation.eventCandidateIds.length > 0
        ? getClarificationsFromCandidates(interpretation.eventCandidateIds)
        : Promise.resolve([]),
    ]);

    // Deduplicate by clarificationId (a clarification might be linked to both signal and candidate)
    const clarificationMap = new Map<string, ClarificationRequest>();
    for (const c of [...directClarifications, ...candidateClarifications]) {
      clarificationMap.set(c.clarificationId, c);
    }
    const clarifications = Array.from(clarificationMap.values());

    // Generate presigned URL for raw content (valid for 15 minutes)
    let rawContentUrl: string | undefined;
    if (signal.rawContentS3Key) {
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: signal.rawContentS3Key,
      });
      rawContentUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    }

    const responseBody: SignalResponse = {
      signal,
      interpretation,
      claims,
      clarifications,
      rawContentUrl,
    };

    return response(200, responseBody);
  } catch (error) {
    console.error('Signal get error:', error);
    return response(500, { error: 'Internal server error' });
  }
};

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
