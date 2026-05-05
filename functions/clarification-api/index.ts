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
  selectedOptionId?: string;  // For option selection
  freeformValue?: string;     // For free-form text input
  resolvedBy: string;
}

// Normalise time input for grassroots gigs (assume PM for single digits)
function normaliseTimeInput(input: string): string {
  const trimmed = input.trim();

  // Already in HH:MM format
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hours, mins] = trimmed.split(':').map(Number);
    // If hours < 12 and likely PM (evening gig), convert to 24h
    if (hours !== undefined && hours < 12 && hours !== 0) {
      return `${hours + 12}:${mins?.toString().padStart(2, '0')}`;
    }
    return `${hours?.toString().padStart(2, '0')}:${mins?.toString().padStart(2, '0')}`;
  }

  // Just a number (e.g., "9" or "21")
  if (/^\d{1,2}$/.test(trimmed)) {
    const hours = parseInt(trimmed, 10);
    // Grassroots gigs are typically afternoon/evening
    // If 1-11, assume PM (13:00-23:00)
    if (hours >= 1 && hours <= 11) {
      return `${hours + 12}:00`;
    }
    // If 12-23, use as-is
    return `${hours.toString().padStart(2, '0')}:00`;
  }

  // Handle "9pm", "9 pm", "21:00" etc.
  const pmMatch = trimmed.match(/^(\d{1,2})\s*(?:pm|PM)$/);
  if (pmMatch?.[1]) {
    const hours = parseInt(pmMatch[1], 10);
    const h24 = hours === 12 ? 12 : hours + 12;
    return `${h24}:00`;
  }

  const amMatch = trimmed.match(/^(\d{1,2})\s*(?:am|AM)$/);
  if (amMatch?.[1]) {
    const hours = parseInt(amMatch[1], 10);
    const h24 = hours === 12 ? 0 : hours;
    return `${h24.toString().padStart(2, '0')}:00`;
  }

  // Return as-is if can't parse
  return trimmed;
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
  } else if (questionType === 'event_time') {
    // Store the time on the candidate
    (updatedCandidate as EventCandidate & { proposedTime?: string }).proposedTime = resolution;
  }

  // Remove resolved ambiguity
  const ambiguityTypeToRemove = questionTypeToAmbiguityType(questionType);
  const remainingAmbiguities = (candidate.ambiguities || []).filter(
    (amb: Ambiguity) => amb.ambiguityType !== ambiguityTypeToRemove
  );

  // Recalculate completeness
  const { completeness, missingFields } = calculateCompleteness(updatedCandidate);

  // Update candidate with all changes
  const proposedTime = (updatedCandidate as EventCandidate & { proposedTime?: string }).proposedTime;
  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
      UpdateExpression:
        'SET updatedAt = :now, proposedVenueId = :venueId, proposedDate = :date, ' +
        'proposedArtistIds = :artistIds, ambiguities = :ambiguities, ' +
        'completeness = :completeness, missingFields = :missingFields' +
        (proposedTime ? ', proposedTime = :time' : ''),
      ExpressionAttributeValues: {
        ':now': now,
        ':venueId': updatedCandidate.proposedVenueId,
        ':date': updatedCandidate.proposedDate,
        ':artistIds': updatedCandidate.proposedArtistIds,
        ':ambiguities': remainingAmbiguities,
        ':completeness': completeness,
        ':missingFields': missingFields,
        ...(proposedTime ? { ':time': proposedTime } : {}),
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

// Resolve a clarification with a selected option or free-form value
export async function resolveClarification(input: ResolveInput): Promise<ResolutionResult> {
  const { clarificationId, selectedOptionId, freeformValue, resolvedBy } = input;

  // Get clarification
  const clarification = await getClarification(clarificationId);
  if (!clarification) {
    return { success: false, error: `Clarification ${clarificationId} not found` };
  }

  // Check if already resolved
  if (clarification.status !== 'open') {
    return { success: false, error: `Clarification ${clarificationId} already resolved or dismissed` };
  }

  let resolution: string;
  let entityIdForCandidate: string | undefined;

  // Handle free-form value (for questions without options, like event_time)
  if (freeformValue !== undefined) {
    // Normalise time input if this is a time question
    if (clarification.questionType === 'event_time') {
      resolution = normaliseTimeInput(freeformValue);
    } else {
      resolution = freeformValue;
    }
  } else if (selectedOptionId) {
    // Handle option selection
    const selectedOption = clarification.options.find(
      (opt: ClarificationOption) => opt.optionId === selectedOptionId
    );
    if (!selectedOption) {
      return { success: false, error: `Option ${selectedOptionId} not found in clarification` };
    }
    resolution = selectedOption.entityId || selectedOption.label;
    entityIdForCandidate = selectedOption.entityId;
  } else {
    return { success: false, error: 'Either selectedOptionId or freeformValue must be provided' };
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
        ':status': 'resolved',
        ':resolvedBy': resolvedBy,
        ':resolution': resolution,
        ':now': now,
      },
    })
  );

  // Update candidate with resolution if applicable
  if (clarification.candidateId) {
    // For entity selections, use the entityId
    // For free-form, use the resolution value directly
    const valueToApply = entityIdForCandidate || resolution;
    await updateCandidateWithResolution(
      clarification.candidateId,
      clarification.questionType,
      valueToApply
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
      const { selectedOptionId, freeformValue, resolvedBy } = body;
      if ((!selectedOptionId && freeformValue === undefined) || !resolvedBy) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing (selectedOptionId or freeformValue) or resolvedBy' }),
        };
      }

      const result = await resolveClarification({
        clarificationId,
        selectedOptionId,
        freeformValue,
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
