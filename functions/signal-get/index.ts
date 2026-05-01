import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Signal, Interpretation, Claim } from '../shared/entities';

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET = process.env.SIGNALS_BUCKET!;
const TABLE = process.env.SIGNALS_TABLE!;

interface SignalResponse {
  signal: Signal;
  interpretation?: Interpretation;
  claims: Claim[];
  rawContentUrl?: string;
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
