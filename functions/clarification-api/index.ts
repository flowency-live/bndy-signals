import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ClarificationRequest, ClarificationOption } from '../shared/entities/clarification';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// Lazy table getter
function getTable(): string {
  const table = process.env.SIGNALS_TABLE;
  if (!table) {
    throw new Error('SIGNALS_TABLE environment variable is required');
  }
  return table;
}

interface ResolveInput {
  clarificationId: string;
  selectedOptionId: string;
  resolvedBy: string;
}

interface DismissInput {
  clarificationId: string;
  dismissedBy: string;
  reason?: string;
}

interface ResolutionResult {
  success: boolean;
  resolution?: string;
  error?: string;
}

// Get a clarification by ID
async function getClarification(clarificationId: string): Promise<ClarificationRequest | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: getTable(),
      Key: { PK: `CLAR#${clarificationId}`, SK: '#METADATA' },
    })
  );

  return result.Item as ClarificationRequest | null;
}

// Update candidate with resolved entity
async function updateCandidateWithResolution(
  candidateId: string,
  questionType: string,
  resolution: string
): Promise<void> {
  const now = new Date().toISOString();

  // Get the candidate first
  const candidateResult = await ddb.send(
    new GetCommand({
      TableName: getTable(),
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
    })
  );

  if (!candidateResult.Item) {
    throw new Error(`Candidate ${candidateId} not found`);
  }

  // Update based on question type
  let updateExpression = 'SET updatedAt = :now';
  const expressionValues: Record<string, unknown> = { ':now': now };

  if (questionType === 'entity_match') {
    // Resolution is a venueId - update proposedVenueId
    updateExpression += ', proposedVenueId = :venueId';
    expressionValues[':venueId'] = resolution;
  } else if (questionType === 'date_confirm') {
    // Resolution is the confirmed date
    updateExpression += ', proposedDate = :date';
    expressionValues[':date'] = resolution;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionValues,
    })
  );
}

// Resolve a clarification with a selected option
export async function resolveClarification(input: ResolveInput): Promise<ResolutionResult> {
  const { clarificationId, selectedOptionId, resolvedBy } = input;

  // Get clarification
  const clarification = await getClarification(clarificationId);
  if (!clarification) {
    return { success: false, error: `Clarification ${clarificationId} not found` };
  }

  // Check if already resolved
  if (clarification.status !== 'open') {
    return { success: false, error: `Clarification ${clarificationId} already resolved or dismissed` };
  }

  // Find the selected option
  const selectedOption = clarification.options.find(
    (opt: ClarificationOption) => opt.optionId === selectedOptionId
  );
  if (!selectedOption) {
    return { success: false, error: `Option ${selectedOptionId} not found in clarification` };
  }

  // Determine resolution value (entityId or label)
  const resolution = selectedOption.entityId || selectedOption.label;
  const now = new Date().toISOString();

  // Update clarification status
  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `CLAR#${clarificationId}`, SK: '#METADATA' },
      UpdateExpression: 'SET #status = :status, resolvedBy = :resolvedBy, resolution = :resolution, resolvedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'resolved',
        ':resolvedBy': resolvedBy,
        ':resolution': resolution,
        ':now': now,
      },
    })
  );

  // Update candidate with resolution if applicable
  if (clarification.candidateId && selectedOption.entityId) {
    await updateCandidateWithResolution(
      clarification.candidateId,
      clarification.questionType,
      selectedOption.entityId
    );
  }

  return { success: true, resolution };
}

// Dismiss a clarification without resolution
export async function dismissClarification(input: DismissInput): Promise<ResolutionResult> {
  const { clarificationId, dismissedBy, reason } = input;

  // Get clarification
  const clarification = await getClarification(clarificationId);
  if (!clarification) {
    return { success: false, error: `Clarification ${clarificationId} not found` };
  }

  // Check if already resolved/dismissed
  if (clarification.status !== 'open') {
    return { success: false, error: `Clarification ${clarificationId} already resolved or dismissed` };
  }

  const now = new Date().toISOString();

  // Update clarification status
  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `CLAR#${clarificationId}`, SK: '#METADATA' },
      UpdateExpression: 'SET #status = :status, resolvedBy = :resolvedBy, resolution = :resolution, resolvedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'dismissed',
        ':resolvedBy': dismissedBy,
        ':resolution': reason || 'dismissed',
        ':now': now,
      },
    })
  );

  return { success: true };
}

// API Gateway handler
export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const clarificationId = event.pathParameters?.clarificationId;
    if (!clarificationId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing clarificationId' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    if (action === 'resolve') {
      const { selectedOptionId, resolvedBy } = body;
      if (!selectedOptionId || !resolvedBy) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing selectedOptionId or resolvedBy' }),
        };
      }

      const result = await resolveClarification({
        clarificationId,
        selectedOptionId,
        resolvedBy,
      });

      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400;
        return {
          statusCode: status,
          body: JSON.stringify({ error: result.error }),
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    }

    if (action === 'dismiss') {
      const { dismissedBy, reason } = body;
      if (!dismissedBy) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing dismissedBy' }),
        };
      }

      const result = await dismissClarification({
        clarificationId,
        dismissedBy,
        reason,
      });

      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400;
        return {
          statusCode: status,
          body: JSON.stringify({ error: result.error }),
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unknown action: ${action}` }),
    };
  } catch (error) {
    console.error('Error processing clarification:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
