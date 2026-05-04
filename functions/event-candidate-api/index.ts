import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { EventCandidate } from '../shared/entities/event-candidate';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.SIGNALS_TABLE!;

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = prefix;
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const path = event.path;
  const candidateId = event.pathParameters?.candidateId;

  // GET /candidates - list proposed candidates
  if (method === 'GET' && path === '/candidates') {
    return listCandidates();
  }

  // GET /candidates/{candidateId} - get candidate details
  if (method === 'GET' && candidateId && !path.includes('/ratify') && !path.includes('/reject')) {
    return getCandidate(candidateId);
  }

  // POST /candidates/{candidateId}/ratify - ratify candidate
  if (method === 'POST' && candidateId && path.includes('/ratify')) {
    return ratifyCandidate(candidateId);
  }

  // POST /candidates/{candidateId}/reject - reject candidate
  if (method === 'POST' && candidateId && path.includes('/reject')) {
    const body = JSON.parse(event.body || '{}');
    return rejectCandidate(candidateId, body.reason);
  }

  return {
    statusCode: 404,
    headers: corsHeaders(),
    body: JSON.stringify({ error: 'Not found' }),
  };
};

async function listCandidates() {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'STATUS#proposed',
      },
    })
  );

  const candidates = (result.Items || []).map(stripDynamoKeys);

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ candidates }),
  };
}

async function getCandidate(candidateId: string) {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Candidate not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify(stripDynamoKeys(result.Item)),
  };
}

async function ratifyCandidate(candidateId: string) {
  // Fetch candidate
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Candidate not found' }),
    };
  }

  const candidate = result.Item as EventCandidate & { PK: string; SK: string };

  // Check for unresolved ambiguities
  if (candidate.ambiguities && candidate.ambiguities.length > 0) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: 'Cannot ratify candidate with unresolved ambiguities',
        ambiguities: candidate.ambiguities,
      }),
    };
  }

  // Check for completeness
  if (candidate.completeness !== 'complete') {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: 'Cannot ratify incomplete candidate',
        missingFields: candidate.missingFields,
      }),
    };
  }

  const now = new Date().toISOString();
  const eventId = generateId('evnt_');

  // Update candidate status to ratified
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
      UpdateExpression: 'SET #status = :status, GSI1PK = :gsi1pk, ratifiedAt = :ratifiedAt, ratifiedEventId = :eventId',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'ratified',
        ':gsi1pk': 'STATUS#ratified',
        ':ratifiedAt': now,
        ':eventId': eventId,
      },
    })
  );

  // Create canonical event
  const canonicalEvent = {
    PK: `EVENT#${eventId}`,
    SK: '#METADATA',
    GSI1PK: 'ENTITY#event',
    GSI1SK: eventId,
    entityId: eventId,
    entityType: 'event',
    name: candidate.proposedName,
    date: candidate.proposedDate,
    time: candidate.proposedTime,
    venueId: candidate.proposedVenueId,
    artistIds: candidate.proposedArtistIds,
    sourceCandidateId: candidateId,
    sourceSignalId: candidate.signalId,
    status: 'published',
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: canonicalEvent,
    })
  );

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      action: 'ratified',
      candidateId,
      eventId,
    }),
  };
}

async function rejectCandidate(candidateId: string, reason?: string) {
  // Fetch candidate
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Candidate not found' }),
    };
  }

  // Require reason for rejection
  if (!reason) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Rejection requires a reason' }),
    };
  }

  const now = new Date().toISOString();

  // Update candidate status to rejected
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
      UpdateExpression: 'SET #status = :status, GSI1PK = :gsi1pk, rejectedAt = :rejectedAt, rejectionReason = :reason',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'rejected',
        ':gsi1pk': 'STATUS#rejected',
        ':rejectedAt': now,
        ':reason': reason,
      },
    })
  );

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      action: 'rejected',
      candidateId,
    }),
  };
}

function stripDynamoKeys(item: Record<string, unknown>): Record<string, unknown> {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  return rest;
}
