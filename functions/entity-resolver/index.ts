import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 8);
import {
  Claim,
  ClaimType,
  CanonicalArtist,
  CanonicalVenue,
  CanonicalEvent,
  CanonicalEntity,
  EntityType,
  EvidenceLink,
} from '../shared/entities';

export interface EntityResolutionResult {
  action: 'created' | 'linked';
  entity: CanonicalEntity;
  entityType: EntityType;
}

const SIMILARITY_THRESHOLD = 0.85;

export function extractEntityTypeFromClaim(claimType: ClaimType): EntityType | null {
  switch (claimType) {
    case 'artist_performs':
    case 'artist_exists':
      return 'artist';
    case 'venue_hosts':
    case 'venue_exists':
      return 'venue';
    case 'event_exists':
    case 'event_date':
    case 'event_time':
      return 'event';
    case 'relationship':
    case 'ticket_source':
    default:
      return null;
  }
}

export function normalizeEntityName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  // Remove leading "the " (with space)
  if (trimmed.startsWith('the ')) {
    return trimmed.slice(4);
  }
  return trimmed;
}

export function calculateNameSimilarity(name1: string, name2: string): number {
  const normalized1 = normalizeEntityName(name1);
  const normalized2 = normalizeEntityName(name2);

  if (normalized1 === normalized2) {
    return 1;
  }

  if (normalized1.length === 0 && normalized2.length === 0) {
    return 1;
  }

  if (normalized1.length === 0 || normalized2.length === 0) {
    return 0;
  }

  // Levenshtein distance for fuzzy matching
  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);
  return 1 - distance / maxLength;
}

function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Create 2D array with explicit initialization
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }

  return dp[m]![n]!;
}

function generateEntityId(entityType: EntityType): string {
  const prefix = {
    artist: 'arts',
    venue: 'vnue',
    event: 'evnt',
  }[entityType];
  return `${prefix}_${nanoid(8)}`;
}

export function createDraftEntity(
  entityType: EntityType,
  claim: Claim,
  now: string
): CanonicalEntity {
  const entityId = generateEntityId(entityType);
  const evidenceLink: EvidenceLink = {
    claimId: claim.claimId,
    claimType: claim.claimType,
    strength: claim.strength,
    linkedAt: now,
  };

  const baseEntity = {
    entityId,
    name: claim.subject,
    status: 'draft' as const,
    evidence: [evidenceLink],
    createdAt: now,
    updatedAt: now,
  };

  switch (entityType) {
    case 'artist':
      return {
        ...baseEntity,
        entityType: 'artist',
        aliases: [],
      } as CanonicalArtist;

    case 'venue':
      return {
        ...baseEntity,
        entityType: 'venue',
        aliases: [],
      } as CanonicalVenue;

    case 'event':
      return {
        ...baseEntity,
        entityType: 'event',
        startDate: '', // Will be filled from event_date claim
        venueId: '', // Will be filled from relationship
        artistIds: [],
      } as unknown as CanonicalEvent;

    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}

export function linkClaimToEntity(
  entity: CanonicalEntity,
  claim: Claim,
  now: string
): CanonicalEntity {
  // Check if claim is already linked
  const alreadyLinked = entity.evidence.some((e) => e.claimId === claim.claimId);
  if (alreadyLinked) {
    return entity;
  }

  const newEvidence: EvidenceLink = {
    claimId: claim.claimId,
    claimType: claim.claimType,
    strength: claim.strength,
    linkedAt: now,
  };

  return {
    ...entity,
    evidence: [...entity.evidence, newEvidence],
    updatedAt: now,
  };
}

export async function findExistingEntity(
  entityType: EntityType,
  name: string,
  ddb: DynamoDBDocumentClient
): Promise<CanonicalEntity | null> {
  const TABLE = process.env.SIGNALS_TABLE!;
  const normalizedName = normalizeEntityName(name);

  // Query entities of this type from GSI
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `ENTITY_TYPE#${entityType}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  // Find best match by name similarity
  let bestMatch: CanonicalEntity | null = null;
  let bestSimilarity = 0;

  for (const item of result.Items) {
    const entityName = item.name as string;
    const similarity = calculateNameSimilarity(name, entityName);

    if (similarity >= SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = item as unknown as CanonicalEntity;
    }
  }

  return bestMatch;
}

export async function resolveEntityFromClaim(
  claim: Claim,
  ddb: DynamoDBDocumentClient
): Promise<EntityResolutionResult | null> {
  const entityType = extractEntityTypeFromClaim(claim.claimType);

  if (!entityType) {
    return null;
  }

  const TABLE = process.env.SIGNALS_TABLE!;
  const now = new Date().toISOString();

  // Find existing entity
  const existingEntity = await findExistingEntity(entityType, claim.subject, ddb);

  if (existingEntity) {
    // Link claim to existing entity
    const updatedEntity = linkClaimToEntity(existingEntity, claim, now);

    // Update in DynamoDB
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: {
          PK: `ENTITY#${updatedEntity.entityId}`,
          SK: '#METADATA',
        },
        UpdateExpression: 'SET evidence = :evidence, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':evidence': updatedEntity.evidence,
          ':updatedAt': now,
        },
      })
    );

    return {
      action: 'linked',
      entity: updatedEntity,
      entityType,
    };
  }

  // Create new draft entity
  const newEntity = createDraftEntity(entityType, claim, now);

  // Store in DynamoDB
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `ENTITY#${newEntity.entityId}`,
        SK: '#METADATA',
        GSI1PK: `ENTITY_TYPE#${entityType}`,
        GSI1SK: `NAME#${normalizeEntityName(newEntity.name)}`,
        ...newEntity,
      },
    })
  );

  return {
    action: 'created',
    entity: newEntity,
    entityType,
  };
}
