import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveEntityFromClaim,
  extractEntityTypeFromClaim,
  findExistingEntity,
  createDraftEntity,
  linkClaimToEntity,
  normalizeEntityName,
  matchesEntityName,
  EntityResolutionResult,
} from './index';
import { Claim, ClaimType, Strength } from '../shared/entities/claim';
import { CanonicalArtist, CanonicalVenue } from '../shared/entities/canonical-entity';

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

  // Event claims return null - events require aggregation from multiple claims
  it('returns null for event_exists claim (events need aggregation)', () => {
    expect(extractEntityTypeFromClaim('event_exists')).toBeNull();
  });

  it('returns null for event_date claim (events need aggregation)', () => {
    expect(extractEntityTypeFromClaim('event_date')).toBeNull();
  });

  it('returns null for event_time claim (events need aggregation)', () => {
    expect(extractEntityTypeFromClaim('event_time')).toBeNull();
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

// AI-native approach: exact match only after normalization.
// No fuzzy matching algorithms - the Brain handles spelling variations.
describe('matchesEntityName', () => {
  it('matches exact names', () => {
    expect(matchesEntityName('Stingray', 'Stingray')).toBe(true);
  });

  it('matches case-insensitive', () => {
    expect(matchesEntityName('Stingray', 'stingray')).toBe(true);
    expect(matchesEntityName('STINGRAY', 'stingray')).toBe(true);
  });

  it('matches ignoring "The" prefix', () => {
    expect(matchesEntityName('The Rigger', 'Rigger')).toBe(true);
    expect(matchesEntityName('Rigger', 'The Rigger')).toBe(true);
  });

  // Typos should NOT match - the Brain fixes typos during claim generation
  it('does not match typos (Brain handles this)', () => {
    expect(matchesEntityName('Stingray', 'Stingry')).toBe(false);
  });

  it('does not match different names', () => {
    expect(matchesEntityName('Stingray', 'Blue Note')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(matchesEntityName('', '')).toBe(true);
    expect(matchesEntityName('Stingray', '')).toBe(false);
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

  // NOTE: Event draft creation removed - events require aggregation from multiple claims
  // See ADR-004 for rationale

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

  it('returns null for event_exists claims - events require aggregation', async () => {
    // Event claims should not auto-create entities because events require:
    // - startDate (from event_date claim)
    // - venueId (from relationship claim)
    // These must be aggregated before an event can be created
    const claim: Partial<Claim> = {
      claimId: 'clm_event01',
      claimType: 'event_exists',
      subject: 'Stingray Live at The Rigger',
      predicate: 'exists',
      object: 'true',
      strength: 'moderate',
      signalId: 'sgnl_abc1234',
      interpretationId: 'intp_abc1234',
      status: 'accepted',
      createdAt: '2026-05-03T12:00:00.000Z',
      strengthReasoning: 'Clear event reference',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    // Event claims should return null - events need conversational ratification
    expect(result).toBeNull();
  });

  it('returns null for event_date claims', async () => {
    const claim: Partial<Claim> = {
      claimId: 'clm_evntdt1',
      claimType: 'event_date',
      subject: 'Stingray Live at The Rigger',
      predicate: 'occurs_on',
      value: '2026-05-15',
      strength: 'strong',
      signalId: 'sgnl_abc1234',
      interpretationId: 'intp_abc1234',
      status: 'accepted',
      createdAt: '2026-05-03T12:00:00.000Z',
      strengthReasoning: 'Clear date',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    expect(result).toBeNull();
  });

  it('returns null for event_time claims', async () => {
    const claim: Partial<Claim> = {
      claimId: 'clm_evnttm1',
      claimType: 'event_time',
      subject: 'Stingray Live at The Rigger',
      predicate: 'starts_at',
      value: '20:00',
      strength: 'strong',
      signalId: 'sgnl_abc1234',
      interpretationId: 'intp_abc1234',
      status: 'accepted',
      createdAt: '2026-05-03T12:00:00.000Z',
      strengthReasoning: 'Clear time',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    expect(result).toBeNull();
  });

  it('returns candidates when multiple venues match the name', async () => {
    // Multiple venues named "The Rigger" in different locations
    const riggerNewcastle = {
      PK: 'ENTITY#vnue_newcastl',
      SK: '#METADATA',
      entityId: 'vnue_newcastl',
      entityType: 'venue',
      name: 'The Rigger',
      aliases: [],
      status: 'draft',
      address: { city: 'Newcastle-under-Lyme', postcode: 'ST5 1AA', line1: '1 High St', country: 'UK' },
      evidence: [
        {
          claimId: 'clm_orig001',
          claimType: 'venue_exists',
          strength: 'moderate',
          linkedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    };

    const riggerBristol = {
      PK: 'ENTITY#vnue_bristol1',
      SK: '#METADATA',
      entityId: 'vnue_bristol1',
      entityType: 'venue',
      name: 'The Rigger',
      aliases: [],
      status: 'draft',
      address: { city: 'Bristol', postcode: 'BS1 1AA', line1: '2 Main St', country: 'UK' },
      evidence: [
        {
          claimId: 'clm_orig002',
          claimType: 'venue_exists',
          strength: 'moderate',
          linkedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    };

    // Return both venues from query
    mockSend.mockResolvedValueOnce({ Items: [riggerNewcastle, riggerBristol] });

    const claim: Partial<Claim> = {
      claimId: 'clm_ambig01',
      claimType: 'venue_hosts',
      subject: 'The Rigger',
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

    // When multiple entities match, should return candidates instead of auto-linking
    expect(result).not.toBeNull();
    expect(result?.action).toBe('candidates');
    expect(result?.candidates).toHaveLength(2);
    expect(result?.candidates?.map(c => c.entity.entityId)).toContain('vnue_newcastl');
    expect(result?.candidates?.map(c => c.entity.entityId)).toContain('vnue_bristol1');
  });

  it('auto-links when only one entity matches above threshold', async () => {
    const singleMatch = {
      PK: 'ENTITY#arts_singlem',
      SK: '#METADATA',
      entityId: 'arts_singlem',
      entityType: 'artist',
      name: 'Stingray',
      aliases: [],
      status: 'draft',
      evidence: [
        {
          claimId: 'clm_orig001',
          claimType: 'artist_exists',
          strength: 'moderate',
          linkedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
      createdAt: '2026-05-01T12:00:00.000Z',
      updatedAt: '2026-05-01T12:00:00.000Z',
    };

    // Return single match
    mockSend.mockResolvedValueOnce({ Items: [singleMatch] });
    // Mock update command
    mockSend.mockResolvedValueOnce({});

    const claim: Partial<Claim> = {
      claimId: 'clm_single1',
      claimType: 'artist_performs',
      subject: 'Stingray',
      predicate: 'performs_at',
      object: 'The Rigger',
      strength: 'moderate',
      signalId: 'sgnl_abc1234',
      interpretationId: 'intp_abc1234',
      status: 'accepted',
      createdAt: '2026-05-03T12:00:00.000Z',
      strengthReasoning: 'Clear artist reference',
    };

    const result = await resolveEntityFromClaim(claim as Claim, mockDynamoDB as any);

    // Single high-confidence match should auto-link
    expect(result?.action).toBe('linked');
    expect(result?.entity.entityId).toBe('arts_singlem');
  });
});
