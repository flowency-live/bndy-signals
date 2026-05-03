import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { resolveEntityFromClaim, EntityResolutionResult } from '../entity-resolver';
import { Claim } from '../shared/entities';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.SIGNALS_TABLE!;

const ReviewActionSchema = z.object({
  action: z.enum(['accept', 'reject', 'challenge']),
  reason: z.string().optional(),
  editedObject: z.string().optional(),
  editedValue: z.string().optional(),
});

type ReviewAction = z.infer<typeof ReviewActionSchema>;

export const handler: APIGatewayProxyHandler = async (event) => {
  const signalId = event.pathParameters?.signalId;
  const claimId = event.pathParameters?.claimId;

  if (!signalId || !claimId) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Missing signalId or claimId' }),
    };
  }

  // Parse request body
  let reviewAction: ReviewAction;
  try {
    const body = JSON.parse(event.body || '{}');
    reviewAction = ReviewActionSchema.parse(body);
  } catch (error) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Invalid request body', details: String(error) }),
    };
  }

  // Verify claim exists and belongs to signal
  const claimResult = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `CLAIM#${claimId}`, SK: '#METADATA' },
    })
  );

  if (!claimResult.Item) {
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Claim not found' }),
    };
  }

  if (claimResult.Item.signalId !== signalId) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Claim does not belong to this signal' }),
    };
  }

  const now = new Date().toISOString();
  let newStatus: string;
  let updateExpression = 'SET #status = :status, GSI1PK = :gsi1pk, reviewedAt = :reviewedAt';
  const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
  const expressionAttributeValues: Record<string, unknown> = {
    ':reviewedAt': now,
  };
  let entityResolution: EntityResolutionResult | null = null;

  switch (reviewAction.action) {
    case 'accept':
      newStatus = 'accepted';
      // Apply edits if provided
      if (reviewAction.editedObject !== undefined) {
        updateExpression += ', #object = :object';
        expressionAttributeNames['#object'] = 'object';
        expressionAttributeValues[':object'] = reviewAction.editedObject;
      }
      if (reviewAction.editedValue !== undefined) {
        updateExpression += ', #value = :value';
        expressionAttributeNames['#value'] = 'value';
        expressionAttributeValues[':value'] = reviewAction.editedValue;
      }
      break;

    case 'reject':
      newStatus = 'rejected';
      if (reviewAction.reason) {
        updateExpression += ', rejectReason = :reason';
        expressionAttributeValues[':reason'] = reviewAction.reason;
      }
      break;

    case 'challenge':
      newStatus = 'challenged';
      if (!reviewAction.reason) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: 'Challenge requires a reason' }),
        };
      }
      updateExpression += ', challengeReason = :reason';
      expressionAttributeValues[':reason'] = reviewAction.reason;
      break;

    default:
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Invalid action' }),
      };
  }

  expressionAttributeValues[':status'] = newStatus;
  expressionAttributeValues[':gsi1pk'] = `STATUS#${newStatus}`;

  // Update claim
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `CLAIM#${claimId}`, SK: '#METADATA' },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  // If claim is accepted, trigger entity resolution
  if (newStatus === 'accepted') {
    const claim = claimResult.Item as Claim;
    entityResolution = await resolveEntityFromClaim(claim, ddb);
  }

  // Build response
  const response: Record<string, unknown> = {
    claimId,
    status: newStatus,
    reviewedAt: now,
  };

  if (entityResolution) {
    response.entityResolution = {
      action: entityResolution.action,
      entityId: entityResolution.entity.entityId,
      entityType: entityResolution.entityType,
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify(response),
  };
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
