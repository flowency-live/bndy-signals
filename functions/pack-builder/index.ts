import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { customAlphabet } from 'nanoid';
import {
  EvidencePack,
  PropositionType,
  CorroborationStrength,
  calculateCorroborationStrength,
} from '../shared/entities/evidence-pack';

const alphanumeric = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nanoid = customAlphabet(alphanumeric, 8);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// Lazy table getter - fails fast at runtime, not module load
function getTable(): string {
  const table = process.env.SIGNALS_TABLE;
  if (!table) {
    throw new Error('SIGNALS_TABLE environment variable is required');
  }
  return table;
}

// Input from interpretation completion
export interface PackBuilderInput {
  signalId: string;
  interpretationId: string;
  // Note: claims array preserved for backwards compatibility but not used
  // Each candidate has its own sourceClaimIds
  claims: Array<{
    claimId: string;
    claimType: string;
    subject?: string;
    value?: string;
  }>;
  eventCandidates: Array<{
    candidateId: string;
    proposedName: string;
    proposedDate?: string;
    proposedVenueName?: string;
    proposedArtistNames: string[];
    sourceClaimIds: string[];  // Claims specifically linked to this candidate
  }>;
}

export interface PackBuilderOutput {
  packIds: string[];
  candidatePackLinks: Array<{
    candidateId: string;
    packId: string;
  }>;
}

// Build human-readable proposition from event candidate
export function buildProposition(candidate: {
  proposedName: string;
  proposedDate?: string;
  proposedVenueName?: string;
  proposedArtistNames: string[];
}): { proposition: string; propositionType: PropositionType } {
  const artists = candidate.proposedArtistNames.join(', ');
  const venue = candidate.proposedVenueName || 'unknown venue';
  const date = candidate.proposedDate;

  let proposition: string;
  if (date) {
    proposition = `${artists} play${candidate.proposedArtistNames.length === 1 ? 's' : ''} at ${venue} on ${date}`;
  } else {
    proposition = `${artists} play${candidate.proposedArtistNames.length === 1 ? 's' : ''} at ${venue}`;
  }

  return {
    proposition,
    propositionType: 'event',
  };
}

// Normalize proposition to a key for fuzzy matching
// Handles case, spacing, common prefixes like "The" and "O2"
export function buildPropositionKey(proposition: string): string {
  return proposition
    .toLowerCase()
    .replace(/\s+/g, ' ')           // Collapse multiple spaces
    .replace(/\bthe\s+/g, '')       // Strip "the " prefix
    .replace(/\bo2\s+/g, '')        // Strip "O2 " prefix
    .replace(/\bplays\b/g, 'play')  // Normalize "plays" to "play"
    .trim();
}

// Find existing pack that matches this proposition (using normalized key)
export async function findMatchingPack(input: {
  proposition: string;
  propositionType: PropositionType;
}): Promise<EvidencePack | null> {
  const propositionKey = buildPropositionKey(input.proposition);

  // Query by propositionKey for fuzzy matching
  const result = await ddb.send(
    new QueryCommand({
      TableName: getTable(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: 'propositionKey = :key',
      ExpressionAttributeValues: {
        ':pk': `PACK#type#${input.propositionType}`,
        ':key': propositionKey,
      },
    })
  );

  if (result.Items && result.Items.length > 0) {
    const item = result.Items[0];
    return {
      packId: item.packId,
      proposition: item.proposition,
      propositionKey: item.propositionKey,
      propositionType: item.propositionType,
      signalIds: item.signalIds,
      interpretationIds: item.interpretationIds,
      claimIds: item.claimIds,
      candidateIds: item.candidateIds,
      corroborationStrength: item.corroborationStrength,
      corroborationReasoning: item.corroborationReasoning,
      sourceCount: item.sourceCount,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    } as EvidencePack;
  }

  return null;
}

// Create a new evidence pack
export async function createPack(input: {
  signalId: string;
  interpretationId: string;
  claimIds: string[];
  candidateId: string;
  proposition: string;
  propositionType: PropositionType;
}): Promise<EvidencePack> {
  const packId = `pack_${nanoid()}`;
  const now = new Date().toISOString();
  const propositionKey = buildPropositionKey(input.proposition);

  // Single source = weak strength
  const { strength, reasoning } = calculateCorroborationStrength({
    sourceCount: 1,
    trustedSourceCount: 0,
  });

  const pack: EvidencePack = {
    packId,
    proposition: input.proposition,
    propositionKey,
    propositionType: input.propositionType,
    signalIds: [input.signalId],
    interpretationIds: [input.interpretationId],
    claimIds: input.claimIds,
    candidateIds: [input.candidateId],
    corroborationStrength: strength,
    corroborationReasoning: reasoning,
    sourceCount: 1,
    status: 'gathering',
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: getTable(),
      Item: {
        PK: `PACK#${packId}`,
        SK: '#METADATA',
        GSI1PK: `PACK#type#${input.propositionType}`,
        GSI1SK: packId,
        propositionKey,  // For indexed matching
        ...pack,
      },
    })
  );

  return pack;
}

// Update existing pack with new evidence
export async function updatePackWithNewEvidence(
  existingPack: EvidencePack,
  newEvidence: {
    signalId: string;
    interpretationId: string;
    claimIds: string[];
    candidateId: string;
  }
): Promise<EvidencePack> {
  const now = new Date().toISOString();

  // Add new signal if not already present (dedup)
  const signalIds = existingPack.signalIds.includes(newEvidence.signalId)
    ? existingPack.signalIds
    : [...existingPack.signalIds, newEvidence.signalId];

  // Add new interpretation
  const interpretationIds = [...existingPack.interpretationIds, newEvidence.interpretationId];

  // Add new claims
  const claimIds = [...existingPack.claimIds, ...newEvidence.claimIds];

  // Add new candidate if not already present
  const candidateIds = existingPack.candidateIds.includes(newEvidence.candidateId)
    ? existingPack.candidateIds
    : [...existingPack.candidateIds, newEvidence.candidateId];

  // Recalculate strength based on unique source count
  const sourceCount = signalIds.length;
  const { strength, reasoning } = calculateCorroborationStrength({
    sourceCount,
    trustedSourceCount: 0, // TODO: Track trusted sources when we have verification
  });

  const updatedPack: EvidencePack = {
    ...existingPack,
    signalIds,
    interpretationIds,
    claimIds,
    candidateIds,
    corroborationStrength: strength,
    corroborationReasoning: reasoning,
    sourceCount,
    updatedAt: now,
  };

  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `PACK#${existingPack.packId}`, SK: '#METADATA' },
      UpdateExpression: `
        SET signalIds = :signalIds,
            interpretationIds = :interpretationIds,
            claimIds = :claimIds,
            candidateIds = :candidateIds,
            corroborationStrength = :strength,
            corroborationReasoning = :reasoning,
            sourceCount = :sourceCount,
            updatedAt = :updatedAt
      `,
      ExpressionAttributeValues: {
        ':signalIds': signalIds,
        ':interpretationIds': interpretationIds,
        ':claimIds': claimIds,
        ':candidateIds': candidateIds,
        ':strength': strength,
        ':reasoning': reasoning,
        ':sourceCount': sourceCount,
        ':updatedAt': now,
      },
    })
  );

  return updatedPack;
}

// Update candidate with evidencePackId
async function linkCandidateToPack(candidateId: string, packId: string): Promise<void> {
  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: getTable(),
      Key: { PK: `CANDIDATE#${candidateId}`, SK: '#METADATA' },
      UpdateExpression: 'SET evidencePackId = :packId, updatedAt = :now',
      ExpressionAttributeValues: {
        ':packId': packId,
        ':now': now,
      },
    })
  );
}

// Main handler - called from Step Functions after interpretation
export const handler: Handler<PackBuilderInput, PackBuilderOutput> = async (event) => {
  const { signalId, interpretationId, claims, eventCandidates } = event;

  const packIds: string[] = [];
  const candidatePackLinks: Array<{ candidateId: string; packId: string }> = [];

  // Process each event candidate
  for (const candidate of eventCandidates) {
    // Build proposition from candidate
    const { proposition, propositionType } = buildProposition(candidate);

    // Use candidate-specific claim IDs (not all interpretation claims)
    const relatedClaimIds = candidate.sourceClaimIds || [];

    // Check if a pack already exists for this proposition
    const existingPack = await findMatchingPack({ proposition, propositionType });

    let pack: EvidencePack;

    if (existingPack) {
      // Update existing pack with new evidence
      pack = await updatePackWithNewEvidence(existingPack, {
        signalId,
        interpretationId,
        claimIds: relatedClaimIds,
        candidateId: candidate.candidateId,
      });
    } else {
      // Create new pack
      pack = await createPack({
        signalId,
        interpretationId,
        claimIds: relatedClaimIds,
        candidateId: candidate.candidateId,
        proposition,
        propositionType,
      });
    }

    // Link candidate to pack
    await linkCandidateToPack(candidate.candidateId, pack.packId);

    packIds.push(pack.packId);
    candidatePackLinks.push({
      candidateId: candidate.candidateId,
      packId: pack.packId,
    });
  }

  return {
    packIds,
    candidatePackLinks,
  };
};
