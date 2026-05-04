import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ClarificationRequest,
  ClarificationQuestionType,
  ClarificationOption,
  generateClarificationId,
  generateOptionId,
} from '../shared/entities/clarification';
import { AmbiguityType } from '../shared/entities/event-candidate';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// Lazy table getter - fails fast at runtime
function getTable(): string {
  const table = process.env.SIGNALS_TABLE;
  if (!table) {
    throw new Error('SIGNALS_TABLE environment variable is required');
  }
  return table;
}

// Input from interpretation completion
interface CandidateWithAmbiguity {
  candidateId: string;
  proposedName: string;
  proposedDate?: string;
  proposedVenueName?: string;
  proposedArtistNames?: string[];
  ambiguities: Array<{
    ambiguityType: AmbiguityType;
    description: string;
    affectedClaimIds: string[];
  }>;
}

export interface ClarificationGeneratorInput {
  signalId: string;
  interpretationId: string;
  candidates: CandidateWithAmbiguity[];
}

export interface ClarificationGeneratorOutput {
  clarificationIds: string[];
  clarificationsByCandidateId: Record<string, string[]>;
}

// Map ambiguity type to clarification question type
function mapAmbiguityToQuestionType(ambiguityType: AmbiguityType): ClarificationQuestionType {
  switch (ambiguityType) {
    case 'entity_match':
      return 'entity_match';
    case 'date_uncertain':
      return 'date_confirm';
    case 'conflicting':
    case 'incomplete':
    default:
      return 'entity_match';
  }
}

// Find matching venues for entity resolution
// Uses nameLower field for case-insensitive matching
async function findMatchingVenues(venueName: string): Promise<Array<{
  entityId: string;
  name: string;
  city?: string;
}>> {
  const normalizedName = venueName.toLowerCase();

  const result = await ddb.send(
    new QueryCommand({
      TableName: getTable(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: 'contains(nameLower, :name)',
      ExpressionAttributeValues: {
        ':pk': 'ENTITY#venue',
        ':name': normalizedName,
      },
    })
  );

  return (result.Items || []).map((item) => ({
    entityId: item.entityId,
    name: item.name,
    city: item.address?.city,
  }));
}

// Update candidate with clarificationIds
async function updateCandidateWithClarifications(
  candidateId: string,
  clarificationIds: string[]
): Promise<void> {
  if (clarificationIds.length === 0) return;

  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
      UpdateExpression: 'SET clarificationIds = :clarIds, updatedAt = :now',
      ExpressionAttributeValues: {
        ':clarIds': clarificationIds,
        ':now': now,
      },
    })
  );
}

// Generate a clarification question from ambiguity
function buildQuestion(
  ambiguity: { ambiguityType: AmbiguityType; description: string },
  candidate: CandidateWithAmbiguity
): string {
  switch (ambiguity.ambiguityType) {
    case 'entity_match':
      return `Which venue is "${candidate.proposedVenueName}" for the event "${candidate.proposedName}"?`;
    case 'date_uncertain':
      return `Is the date ${candidate.proposedDate} correct for "${candidate.proposedName}"?`;
    case 'conflicting':
      return ambiguity.description.endsWith('?') ? ambiguity.description : `${ambiguity.description}?`;
    case 'incomplete':
      return `${ambiguity.description} Please provide more details.`;
    default:
      return ambiguity.description;
  }
}

// Generate clarifications from a single candidate's ambiguities
export async function generateClarificationsFromCandidate(
  candidate: CandidateWithAmbiguity
): Promise<ClarificationRequest[]> {
  const clarifications: ClarificationRequest[] = [];

  if (!candidate.ambiguities || candidate.ambiguities.length === 0) {
    return clarifications;
  }

  for (const ambiguity of candidate.ambiguities) {
    const clarificationId = generateClarificationId();
    const questionType = mapAmbiguityToQuestionType(ambiguity.ambiguityType);
    const question = buildQuestion(ambiguity, candidate);

    let options: ClarificationOption[] = [];

    // For entity_match, query for matching entities to build options
    if (ambiguity.ambiguityType === 'entity_match' && candidate.proposedVenueName) {
      const matches = await findMatchingVenues(candidate.proposedVenueName);
      options = matches.map((match) => ({
        optionId: generateOptionId(),
        label: match.city ? `${match.name}, ${match.city}` : match.name,
        entityId: match.entityId,
      }));
    }

    const clarification: ClarificationRequest = {
      clarificationId,
      candidateId: candidate.candidateId,
      question,
      questionType,
      options,
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    // Store clarification in DynamoDB
    await ddb.send(
      new PutCommand({
        TableName: getTable(),
        Item: {
          PK: `CLAR#${clarificationId}`,
          SK: '#METADATA',
          GSI1PK: `CANDIDATE#${candidate.candidateId}`,
          GSI1SK: `CLAR#${clarificationId}`,
          ...clarification,
        },
      })
    );

    clarifications.push(clarification);
  }

  return clarifications;
}

// Main handler - called after interpretation when candidates have ambiguities
export const handler: Handler<ClarificationGeneratorInput, ClarificationGeneratorOutput> = async (
  event
) => {
  const { candidates } = event;

  const allClarificationIds: string[] = [];
  const clarificationsByCandidateId: Record<string, string[]> = {};

  for (const candidate of candidates) {
    const clarifications = await generateClarificationsFromCandidate(candidate);

    const candidateClarIds = clarifications.map((c) => c.clarificationId);
    allClarificationIds.push(...candidateClarIds);

    if (candidateClarIds.length > 0) {
      clarificationsByCandidateId[candidate.candidateId] = candidateClarIds;

      // Update candidate with clarification IDs
      await updateCandidateWithClarifications(candidate.candidateId, candidateClarIds);
    }
  }

  return {
    clarificationIds: allClarificationIds,
    clarificationsByCandidateId,
  };
};
