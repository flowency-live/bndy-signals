import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 8);
import {
  Claim,
  ClaimType,
  CanonicalArtist,
  CanonicalVenue,
  CanonicalEntity,
  EntityType,
  EvidenceLink,
} from '../shared/entities';

export interface EntityCandidate {
  entity: CanonicalEntity;
  // Note: No similarity score. Matching is exact after normalization.
  // The Brain handles fuzzy reasoning, not this code.
}

export interface EntityResolutionResult {
  action: 'created' | 'linked' | 'candidates';
  entity?: CanonicalEntity;
  entityType: EntityType;
  candidates?: EntityCandidate[];
}

// No similarity threshold - matching is exact after normalization.
// The Brain (LLM) handles fuzzy matching during claim generation.

export function extractEntityTypeFromClaim(claimType: ClaimType): EntityType | null {
  switch (claimType) {
    case 'artist_performs':
    case 'artist_exists':
      return 'artist';
    case 'venue_hosts':
    case 'venue_exists':
      return 'venue';
    // Event claims don't auto-resolve - events require aggregation from multiple claims
    // (event_exists + event_date + venue relationship) and conversational ratification
    case 'event_exists':
    case 'event_date':
    case 'event_time':
      return null;
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

// AI-native approach: exact match only after normalization.
// The Brain (LLM) handles spelling variations during claim generation.
// Fuzzy matching algorithms are legacy thinking - the AI should reason about matches.
export function matchesEntityName(claimName: string, entityName: string): boolean {
  return normalizeEntityName(claimName) === normalizeEntityName(entityName);
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

    // NOTE: Event entities are not auto-created from claims.
    // Events require aggregation from multiple claims (event_exists + event_date + venue)
    // and conversational ratification. See ADR-004.
    case 'event':
    default:
      throw new Error(`Cannot auto-create ${entityType} entity - requires conversational ratification`);
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

export async function findMatchingEntities(
  entityType: EntityType,
  name: string,
  ddb: DynamoDBDocumentClient
): Promise<EntityCandidate[]> {
  const TABLE = process.env.SIGNALS_TABLE!;

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
    return [];
  }

  // Find all exact matches (after normalization)
  const candidates: EntityCandidate[] = [];

  for (const item of result.Items) {
    const entityName = item.name as string;

    if (matchesEntityName(name, entityName)) {
      candidates.push({
        entity: item as unknown as CanonicalEntity,
      });
    }
  }

  return candidates;
}

// Deprecated: use findMatchingEntities for candidate-based resolution
export async function findExistingEntity(
  entityType: EntityType,
  name: string,
  ddb: DynamoDBDocumentClient
): Promise<CanonicalEntity | null> {
  const candidates = await findMatchingEntities(entityType, name, ddb);
  return candidates.length > 0 ? candidates[0]!.entity : null;
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

  // Find matching entities
  const candidates = await findMatchingEntities(entityType, claim.subject, ddb);

  // Multiple matches = ambiguous, return candidates for human resolution
  if (candidates.length > 1) {
    return {
      action: 'candidates',
      entityType,
      candidates,
    };
  }

  // Single match = auto-link
  if (candidates.length === 1) {
    const existingEntity = candidates[0]!.entity;
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

  // No matches = create new draft entity
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
