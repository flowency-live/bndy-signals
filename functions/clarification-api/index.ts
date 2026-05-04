import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ClarificationRequest, ClarificationOption } from '../shared/entities/clarification';
import { EventCandidate, Ambiguity, calculateCompleteness } from '../shared/entities/event-candidate';

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

// Map questionType to ambiguityType for filtering
function questionTypeToAmbiguityType(questionType: string): string {
  switch (questionType) {
    case 'entity_match':
      return 'entity_match';
    case 'date_confirm':
      return 'date_uncertain';
    case 'venue_location':
      return 'entity_match';
    case 'artist_identity':
      return 'entity_match';
    default:
      return questionType;
  }
}

// Update candidate with resolved entity, remove ambiguity, recalculate completeness
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

  const candidate = candidateResult.Item as EventCandidate;

  // Build updated candidate with resolved field
  const updatedCandidate: Partial<EventCandidate> = {
    proposedName: candidate.proposedName,
    proposedDate: candidate.proposedDate,
    proposedVenueId: candidate.proposedVenueId,
    proposedArtistIds: candidate.proposedArtistIds,
  };

  // Apply resolution based on question type
  if (questionType === 'entity_match' || questionType === 'venue_location') {
    updatedCandidate.proposedVenueId = resolution;
  } else if (questionType === 'date_confirm') {
    updatedCandidate.proposedDate = resolution;
  } else if (questionType === 'artist_identity') {
    // Add resolved artist to array if not already present
    const artistIds = [...(candidate.proposedArtistIds || [])];
    if (!artistIds.includes(resolution)) {
      artistIds.push(resolution);
    }
    updatedCandidate.proposedArtistIds = artistIds;
  }

  // Remove resolved ambiguity
  const ambiguityTypeToRemove = questionTypeToAmbiguityType(questionType);
  const remainingAmbiguities = (candidate.ambiguities || []).filter(
    (amb: Ambiguity) => amb.ambiguityType !== ambiguityTypeToRemove
  );

  // Recalculate completeness
  const { completeness, missingFields } = calculateCompleteness(updatedCandidate);

  // Update candidate with all changes
  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
      UpdateExpression:
        'SET updatedAt = :now, proposedVenueId = :venueId, proposedDate = :date, ' +
        'proposedArtistIds = :artistIds, ambiguities = :ambiguities, ' +
        'completeness = :completeness, missingFields = :missingFields',
      ExpressionAttributeValues: {
        ':now': now,
        ':venueId': updatedCandidate.proposedVenueId,
        ':date': updatedCandidate.proposedDate,
        ':artistIds': updatedCandidate.proposedArtistIds,
        ':ambiguities': remainingAmbiguities,
        ':completeness': completeness,
        ':missingFields': missingFields,
      },
    })
  );

  // Update evidence pack if one exists
  if (candidate.evidencePackId) {
    await updateEvidencePackCompleteness(candidate.evidencePackId, completeness);
  }
}

// Update evidence pack when candidate completeness changes
async function updateEvidencePackCompleteness(
  packId: string,
  candidateCompleteness: string
): Promise<void> {
  const now = new Date().toISOString();

  // Update the pack's updatedAt to reflect the change
  // The pack itself doesn't store completeness, but we mark it as updated
  // so consumers know to re-fetch candidate data
  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `PACK#${packId}`, SK: '#METADATA' },
      UpdateExpression: 'SET updatedAt = :now',
      ExpressionAttributeValues: {
        ':now': now,
      },
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
