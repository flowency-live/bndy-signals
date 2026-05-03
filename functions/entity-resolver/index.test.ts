import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveEntityFromClaim,
  extractEntityTypeFromClaim,
  findExistingEntity,
  createDraftEntity,
  linkClaimToEntity,
  normalizeEntityName,
  calculateNameSimilarity,
  EntityResolutionResult,
} from './index';
import { Claim, ClaimType, Strength } from '../shared/entities/claim';
import { CanonicalArtist, CanonicalVenue, CanonicalEvent } from '../shared/entities/canonical-entity';

const mockSend = vi.fn();

const mockDynamoDB = {
  send: mockSend,
};

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => mockDynamoDB,
  },
  QueryCommand: class QueryCommand {
    constructor(public input: unknown) {}
  },
  PutCommand: class PutCommand {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class UpdateCommand {
    constructor(public input: unknown) {}
  },
}));

describe('extractEntityTypeFromClaim', () => {
  it('returns artist for artist_performs claim', () => {
    expect(extractEntityTypeFromClaim('artist_performs')).toBe('artist');
  });

  it('returns artist for artist_exists claim', () => {
    expect(extractEntityTypeFromClaim('artist_exists')).toBe('artist');
  });

  it('returns venue for venue_hosts claim', () => {
    expect(extractEntityTypeFromClaim('venue_hosts')).toBe('venue');
  });

  it('returns venue for venue_exists claim', () => {
    expect(extractEntityTypeFromClaim('venue_exists')).toBe('venue');
  });

  it('returns event for event_exists claim', () => {
    expect(extractEntityTypeFromClaim('event_exists')).toBe('event');
  });

  it('returns event for event_date claim', () => {
    expect(extractEntityTypeFromClaim('event_date')).toBe('event');
  });

  it('returns event for event_time claim', () => {
    expect(extractEntityTypeFromClaim('event_time')).toBe('event');
  });

  it('returns null for relationship claim', () => {
    expect(extractEntityTypeFromClaim('relationship')).toBeNull();
  });

  it('returns null for ticket_source claim', () => {
    expect(extractEntityTypeFromClaim('ticket_source')).toBeNull();
  });
});

describe('normalizeEntityName', () => {
  it('lowercases name', () => {
    expect(normalizeEntityName('Stingray')).toBe('stingray');
  });

  it('removes leading "The"', () => {
    expect(normalizeEntityName('The Rigger')).toBe('rigger');
  });

  it('removes leading "the" (lowercase)', () => {
    expect(normalizeEntityName('the Rigger')).toBe('rigger');
  });

  it('trims whitespace', () => {
    expect(normalizeEntityName('  Stingray  ')).toBe('stingray');
  });

  it('preserves "the" in middle of name', () => {
    expect(normalizeEntityName('Band of the North')).toBe('band of the north');
  });

  it('handles empty string', () => {
    expect(normalizeEntityName('')).toBe('');
  });
});

describe('calculateNameSimilarity', () => {
  it('returns 1 for exact match', () => {
    expect(calculateNameSimilarity('Stingray', 'Stingray')).toBe(1);
  });

  it('returns 1 for case-insensitive match', () => {
    expect(calculateNameSimilarity('Stingray', 'stingray')).toBe(1);
  });

  it('returns 1 for match ignoring "The"', () => {
    expect(calculateNameSimilarity('The Rigger', 'Rigger')).toBe(1);
  });

  it('returns high similarity for minor typo', () => {
    const similarity = calculateNameSimilarity('Stingray', 'Stingry');
    expect(similarity).toBeGreaterThan(0.8);
  });

  it('returns low similarity for different names', () => {
    const similarity = calculateNameSimilarity('Stingray', 'Blue Note');
    expect(similarity).toBeLessThan(0.5);
  });

  it('handles empty strings', () => {
    expect(calculateNameSimilarity('', '')).toBe(1);
    expect(calculateNameSimilarity('Stingray', '')).toBe(0);
  });
});

describe('createDraftEntity', () => {
  const now = '2026-05-03T12:00:00.000Z';

  it('creates draft artist from artist claim', () => {
    const claim: Partial<Claim> = {
      claimId: 'clm_abc12345',
      claimType: 'artist_performs',
      subject: 'Stingray',
      predicate: 'performs_at',
      object: 'The Rigger',
      strength: 'moderate',
    };

    const result = createDraftEntity('artist', claim as Claim, now);

    expect(result.entityType).toBe('artist');
    expect(result.name).toBe('Stingray');
    expect(result.status).toBe('draft');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].claimId).toBe('clm_abc12345');
    expect(result.entityId).toMatch(/^arts_[a-zA-Z0-9]{8}$/);
  });

  it('creates draft venue from venue claim', () => {
    const claim: Partial<Claim> = {
      claimId: 'clm_abc12345',
      claimType: 'venue_hosts',
      subject: 'The Rigger',
      predicate: 'hosts',
      object: 'Stingray Live',
      strength: 'moderate',
    };

    const result = createDraftEntity('venue', claim as Claim, now);

    expect(result.entityType).toBe('venue');
    expect(result.name).toBe('The Rigger');
    expect(result.status).toBe('draft');
    expect(result.entityId).toMatch(/^vnue_[a-zA-Z0-9]{8}$/);
  });

  it('creates draft event from event claim', () => {
    const claim: Partial<Claim> = {
      claimId: 'clm_abc12345',
      claimType: 'event_exists',
      subject: 'Stingray Live at The Rigger',
      predicate: 'exists',
      object: 'true',
      strength: 'moderate',
    };

    const result = createDraftEntity('event', claim as Claim, now);

    expect(result.entityType).toBe('event');
    expect(result.name).toBe('Stingray Live at The Rigger');
    expect(result.status).toBe('draft');
    expect(result.entityId).toMatch(/^evnt_[a-zA-Z0-9]{8}$/);
  });

  it('includes strength in evidence link', () => {
    const claim: Partial<Claim> = {
      claimId: 'clm_abc12345',
      claimType: 'artist_performs',
      subject: 'Stingray',
      predicate: 'performs_at',
      strength: 'strong',
    };

    const result = createDraftEntity('artist', claim as Claim, now);

    expect(result.evidence[0].strength).toBe('strong');
  });
});

describe('linkClaimToEntity', () => {
  it('adds claim to existing entity evidence', () => {
    const existingArtist: CanonicalArtist = {
      entityId: 'arts_existing',
      entityType: 'artist',
      name: 'Stingray',
      aliases: [],
      status: 'draft',
      evidence: [
        {
          claimId: 'clm_original',
          claimType: 'artist_exists',
          strength: 'weak',
          linkedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    };

    const newClaim: Partial<Claim> = {
      claimId: 'clm_newclaim',
      claimType: 'artist_performs',
      subject: 'Stingray',
      strength: 'moderate',
    };

    const now = '2026-05-03T12:00:00.000Z';
    const result = linkClaimToEntity(existingArtist, newClaim as Claim, now);

    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[1].claimId).toBe('clm_newclaim');
    expect(result.updatedAt).toBe(now);
  });

  it('does not duplicate evidence if claim already linked', () => {
    const existingArtist: CanonicalArtist = {
      entityId: 'arts_existing',
      entityType: 'artist',
      name: 'Stingray',
      aliases: [],
      status: 'draft',
      evidence: [
        {
          claimId: 'clm_existing',
          claimType: 'artist_exists',
          strength: 'weak',
          linkedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    };

    const duplicateClaim: Partial<Claim> = {
      claimId: 'clm_existing',
      claimType: 'artist_exists',
      strength: 'weak',
    };

    const now = '2026-05-03T12:00:00.000Z';
    const result = linkClaimToEntity(existingArtist, duplicateClaim as Claim, now);

    expect(result.evidence).toHaveLength(1);
  });
});

describe('resolveEntityFromClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for non-entity claims', async () => {
    const claim: Partial<Claim> = {
      claimId: 'clm_abc12345',
      claimType: 'ticket_source',
      subject: 'Gigantic',
      predicate: 'sells_tickets_for',
      object: 'event_123',
      strength: 'moderate',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    expect(result).toBeNull();
  });

  it('creates new entity when no match found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    const claim: Partial<Claim> = {
      claimId: 'clm_abc12345',
      claimType: 'artist_performs',
      subject: 'Stingray',
      predicate: 'performs_at',
      object: 'The Rigger',
      strength: 'moderate',
      signalId: 'sgnl_abc1234',
      interpretationId: 'intp_abc1234',
      status: 'accepted',
      createdAt: '2026-05-03T12:00:00.000Z',
      strengthReasoning: 'Clear headline in text',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    expect(result).not.toBeNull();
    expect(result?.action).toBe('created');
    expect(result?.entity.entityType).toBe('artist');
    expect(result?.entity.name).toBe('Stingray');
    expect(result?.entity.status).toBe('draft');
  });

  it('links to existing entity when match found', async () => {
    const existingArtist = {
      PK: 'ENTITY#arts_existing',
      SK: '#METADATA',
      entityId: 'arts_existing',
      entityType: 'artist',
      name: 'Stingray',
      aliases: [],
      status: 'draft',
      evidence: [
        {
          claimId: 'clm_original',
          claimType: 'artist_exists',
          strength: 'weak',
          linkedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    };

    mockSend.mockResolvedValueOnce({ Items: [existingArtist] });
    mockSend.mockResolvedValueOnce({});

    const claim: Partial<Claim> = {
      claimId: 'clm_newclaim',
      claimType: 'artist_performs',
      subject: 'Stingray',
      predicate: 'performs_at',
      object: 'The Rigger',
      strength: 'moderate',
      signalId: 'sgnl_abc1234',
      interpretationId: 'intp_abc1234',
      status: 'accepted',
      createdAt: '2026-05-03T12:00:00.000Z',
      strengthReasoning: 'Clear headline in text',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    expect(result).not.toBeNull();
    expect(result?.action).toBe('linked');
    expect(result?.entity.entityId).toBe('arts_existing');
    expect(result?.entity.evidence).toHaveLength(2);
  });

  it('matches entity ignoring case differences', async () => {
    const existingVenue = {
      PK: 'ENTITY#vnue_existing',
      SK: '#METADATA',
      entityId: 'vnue_existing',
      entityType: 'venue',
      name: 'The Rigger',
      aliases: [],
      status: 'draft',
      evidence: [
        {
          claimId: 'clm_original',
          claimType: 'venue_exists',
          strength: 'weak',
          linkedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    };

    mockSend.mockResolvedValueOnce({ Items: [existingVenue] });
    mockSend.mockResolvedValueOnce({});

    const claim: Partial<Claim> = {
      claimId: 'clm_newclaim',
      claimType: 'venue_hosts',
      subject: 'THE RIGGER',
      predicate: 'hosts',
      object: 'Stingray Live',
      strength: 'moderate',
      signalId: 'sgnl_abc1234',
      interpretationId: 'intp_abc1234',
      status: 'accepted',
      createdAt: '2026-05-03T12:00:00.000Z',
      strengthReasoning: 'Clear venue reference',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    expect(result?.action).toBe('linked');
    expect(result?.entity.entityId).toBe('vnue_existing');
  });

  it('matches entity ignoring "The" prefix', async () => {
    const existingVenue = {
      PK: 'ENTITY#vnue_existing',
      SK: '#METADATA',
      entityId: 'vnue_existing',
      entityType: 'venue',
      name: 'The Rigger',
      aliases: [],
      status: 'draft',
      evidence: [
        {
          claimId: 'clm_original',
          claimType: 'venue_exists',
          strength: 'weak',
          linkedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    };

    mockSend.mockResolvedValueOnce({ Items: [existingVenue] });
    mockSend.mockResolvedValueOnce({});

    const claim: Partial<Claim> = {
      claimId: 'clm_newclaim',
      claimType: 'venue_hosts',
      subject: 'Rigger',
      predicate: 'hosts',
      object: 'Stingray Live',
      strength: 'moderate',
      signalId: 'sgnl_abc1234',
      interpretationId: 'intp_abc1234',
      status: 'accepted',
      createdAt: '2026-05-03T12:00:00.000Z',
      strengthReasoning: 'Clear venue reference',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    expect(result?.action).toBe('linked');
    expect(result?.entity.entityId).toBe('vnue_existing');
  });
});
