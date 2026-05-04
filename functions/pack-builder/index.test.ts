import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted for proper mock hoisting
const { mockSend } = vi.hoisted(() => {
  // Set env early for lazy getTable()
  process.env.SIGNALS_TABLE = 'test-signals-table';
  return { mockSend: vi.fn() };
});

// Mock AWS SDK
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  QueryCommand: vi.fn((params) => ({ type: 'Query', params })),
  PutCommand: vi.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: vi.fn((params) => ({ type: 'Update', params })),
}));

// Import after mocks
import {
  handler,
  buildProposition,
  buildPropositionKey,
  findMatchingPack,
  createPack,
  updatePackWithNewEvidence,
  PackBuilderInput,
  PackBuilderOutput,
} from './index';

describe('buildPropositionKey', () => {
  it('should normalize proposition to lowercase and strip prefixes', () => {
    const proposition = 'The Vaccines plays at O2 Academy Bristol on 2026-06-20';
    const key = buildPropositionKey(proposition);
    // "The" and "O2" are stripped, "plays" → "play"
    expect(key).toBe('vaccines play at academy bristol on 2026-06-20');
  });

  it('should collapse multiple spaces', () => {
    const proposition = 'Stingray  plays   at  The   Rigger';
    const key = buildPropositionKey(proposition);
    // Spaces collapsed, "The" stripped, "plays" → "play"
    expect(key).toBe('stingray play at rigger');
  });

  it('should strip "the" prefix from venue names', () => {
    const key1 = buildPropositionKey('Stingray plays at The Rigger on 2026-05-15');
    const key2 = buildPropositionKey('Stingray plays at Rigger on 2026-05-15');
    expect(key1).toBe(key2);
  });

  it('should normalize "play" vs "plays"', () => {
    const key1 = buildPropositionKey('Stingray plays at The Rigger');
    const key2 = buildPropositionKey('Stingray play at The Rigger');
    expect(key1).toBe(key2);
  });

  it('should match propositions with different capitalization', () => {
    const key1 = buildPropositionKey('THE VACCINES plays at O2 ACADEMY BRISTOL');
    const key2 = buildPropositionKey('The Vaccines plays at O2 Academy Bristol');
    expect(key1).toBe(key2);
  });

  it('should strip common venue prefixes like O2', () => {
    const key1 = buildPropositionKey('Band plays at O2 Academy Bristol');
    const key2 = buildPropositionKey('Band plays at Academy Bristol');
    expect(key1).toBe(key2);
  });
});

describe('buildProposition', () => {
  it('should build proposition for event candidate', () => {
    const candidate = {
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedVenueName: 'The Rigger',
      proposedArtistNames: ['Stingray'],
    };

    const result = buildProposition(candidate);

    expect(result.proposition).toBe('Stingray plays at The Rigger on 2026-05-15');
    expect(result.propositionType).toBe('event');
  });

  it('should handle missing date in proposition', () => {
    const candidate = {
      proposedName: 'Stingray Live',
      proposedVenueName: 'The Rigger',
      proposedArtistNames: ['Stingray'],
    };

    const result = buildProposition(candidate);

    expect(result.proposition).toBe('Stingray plays at The Rigger');
    expect(result.propositionType).toBe('event');
  });

  it('should handle multiple artists', () => {
    const candidate = {
      proposedName: 'Double Bill',
      proposedDate: '2026-06-01',
      proposedVenueName: 'The Forum',
      proposedArtistNames: ['Band A', 'Band B'],
    };

    const result = buildProposition(candidate);

    expect(result.proposition).toBe('Band A, Band B play at The Forum on 2026-06-01');
    expect(result.propositionType).toBe('event');
  });
});

describe('findMatchingPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when no matching pack exists', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await findMatchingPack({
      proposition: 'Stingray plays at The Rigger on 2026-05-15',
      propositionType: 'event',
    });

    expect(result).toBeNull();
  });

  it('should return matching pack when found', async () => {
    const existingPack = {
      packId: 'pack_existing',
      proposition: 'Stingray plays at The Rigger on 2026-05-15',
      propositionKey: 'stingray play at rigger on 2026-05-15',
      propositionType: 'event',
      signalIds: ['sgnl_previous'],
      interpretationIds: ['intp_previous'],
      claimIds: ['clm_prev1', 'clm_prev2'],
      candidateIds: ['cand_previous'],
      corroborationStrength: 'weak',
      corroborationReasoning: 'Single source',
      sourceCount: 1,
      status: 'gathering',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    mockSend.mockResolvedValueOnce({ Items: [existingPack] });

    const result = await findMatchingPack({
      proposition: 'Stingray plays at The Rigger on 2026-05-15',
      propositionType: 'event',
    });

    expect(result).toEqual(existingPack);
  });
});

describe('createPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should create a new pack with weak strength for single source', async () => {
    const input = {
      signalId: 'sgnl_abc12345',
      interpretationId: 'intp_def67890',
      claimIds: ['clm_111', 'clm_222'],
      candidateId: 'cand_xyz12345',
      proposition: 'Stingray plays at The Rigger on 2026-05-15',
      propositionType: 'event' as const,
    };

    const result = await createPack(input);

    expect(result.packId).toMatch(/^pack_[a-zA-Z0-9]{8}$/);
    expect(result.proposition).toBe(input.proposition);
    expect(result.propositionKey).toBe('stingray play at rigger on 2026-05-15');
    expect(result.propositionType).toBe('event');
    expect(result.signalIds).toEqual(['sgnl_abc12345']);
    expect(result.corroborationStrength).toBe('weak');
    expect(result.corroborationReasoning).toContain('Single source');
    expect(result.sourceCount).toBe(1);
    expect(result.status).toBe('gathering');
  });
});

describe('updatePackWithNewEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should add new signal to existing pack and recalculate strength', async () => {
    const existingPack = {
      packId: 'pack_existing',
      proposition: 'Stingray plays at The Rigger on 2026-05-15',
      propositionKey: 'stingray play at rigger on 2026-05-15',
      propositionType: 'event' as const,
      signalIds: ['sgnl_previous'],
      interpretationIds: ['intp_previous'],
      claimIds: ['clm_prev1'],
      candidateIds: ['cand_previous'],
      corroborationStrength: 'weak' as const,
      corroborationReasoning: 'Single source',
      sourceCount: 1,
      status: 'gathering' as const,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    const newEvidence = {
      signalId: 'sgnl_new12345',
      interpretationId: 'intp_new67890',
      claimIds: ['clm_new1', 'clm_new2'],
      candidateId: 'cand_new12345',
    };

    const result = await updatePackWithNewEvidence(existingPack, newEvidence);

    expect(result.signalIds).toContain('sgnl_previous');
    expect(result.signalIds).toContain('sgnl_new12345');
    expect(result.sourceCount).toBe(2);
    expect(result.corroborationStrength).toBe('moderate');
    expect(result.corroborationReasoning).toContain('2 independent sources');
  });

  it('should not duplicate existing signalId', async () => {
    const existingPack = {
      packId: 'pack_existing',
      proposition: 'Stingray plays at The Rigger on 2026-05-15',
      propositionKey: 'stingray play at rigger on 2026-05-15',
      propositionType: 'event' as const,
      signalIds: ['sgnl_same'],
      interpretationIds: ['intp_previous'],
      claimIds: ['clm_prev1'],
      candidateIds: ['cand_previous'],
      corroborationStrength: 'weak' as const,
      corroborationReasoning: 'Single source',
      sourceCount: 1,
      status: 'gathering' as const,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    const newEvidence = {
      signalId: 'sgnl_same', // Same signal - reinterpretation
      interpretationId: 'intp_new67890',
      claimIds: ['clm_new1'],
      candidateId: 'cand_new12345',
    };

    const result = await updatePackWithNewEvidence(existingPack, newEvidence);

    expect(result.signalIds).toEqual(['sgnl_same']);
    expect(result.sourceCount).toBe(1); // Still 1 unique source
    expect(result.corroborationStrength).toBe('weak');
  });

  it('should reach strong strength with 3+ sources', async () => {
    const existingPack = {
      packId: 'pack_existing',
      proposition: 'Stingray plays at The Rigger on 2026-05-15',
      propositionKey: 'stingray play at rigger on 2026-05-15',
      propositionType: 'event' as const,
      signalIds: ['sgnl_1', 'sgnl_2'],
      interpretationIds: ['intp_1', 'intp_2'],
      claimIds: ['clm_1', 'clm_2'],
      candidateIds: ['cand_1', 'cand_2'],
      corroborationStrength: 'moderate' as const,
      corroborationReasoning: '2 sources',
      sourceCount: 2,
      status: 'gathering' as const,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    const newEvidence = {
      signalId: 'sgnl_3',
      interpretationId: 'intp_3',
      claimIds: ['clm_3'],
      candidateId: 'cand_3',
    };

    const result = await updatePackWithNewEvidence(existingPack, newEvidence);

    expect(result.signalIds).toHaveLength(3);
    expect(result.sourceCount).toBe(3);
    expect(result.corroborationStrength).toBe('strong');
    expect(result.corroborationReasoning).toContain('3+ independent sources');
  });
});

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process interpretation with event candidates', async () => {
    // Mock: no existing pack found
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Mock: put new pack
    mockSend.mockResolvedValueOnce({});
    // Mock: update candidate with packId
    mockSend.mockResolvedValueOnce({});

    const input: PackBuilderInput = {
      signalId: 'sgnl_test1234',
      interpretationId: 'intp_test5678',
      claims: [
        { claimId: 'clm_1', claimType: 'event_exists', subject: 'Stingray Live' },
        { claimId: 'clm_2', claimType: 'event_date', value: '2026-05-15' },
        { claimId: 'clm_3', claimType: 'artist_performs', subject: 'Stingray' },
        { claimId: 'clm_4', claimType: 'venue_hosts', subject: 'The Rigger' },
      ],
      eventCandidates: [
        {
          candidateId: 'cand_test1234',
          proposedName: 'Stingray Live',
          proposedDate: '2026-05-15',
          proposedVenueName: 'The Rigger',
          proposedArtistNames: ['Stingray'],
          sourceClaimIds: ['clm_1', 'clm_2', 'clm_3', 'clm_4'],
        },
      ],
    };

    const result = await handler(input);

    expect(result.packIds).toHaveLength(1);
    expect(result.packIds[0]).toMatch(/^pack_[a-zA-Z0-9]{8}$/);
    expect(result.candidatePackLinks).toHaveLength(1);
    expect(result.candidatePackLinks[0].candidateId).toBe('cand_test1234');
  });

  it('should return empty arrays when no event candidates', async () => {
    const input: PackBuilderInput = {
      signalId: 'sgnl_test1234',
      interpretationId: 'intp_test5678',
      claims: [
        { claimId: 'clm_1', claimType: 'artist_exists', subject: 'Stingray' },
      ],
      eventCandidates: [],
    };

    const result = await handler(input);

    expect(result.packIds).toHaveLength(0);
    expect(result.candidatePackLinks).toHaveLength(0);
  });

  it('should update existing pack when proposition matches', async () => {
    const existingPack = {
      packId: 'pack_existing',
      proposition: 'Stingray plays at The Rigger on 2026-05-15',
      propositionKey: 'stingray play at rigger on 2026-05-15',
      propositionType: 'event',
      signalIds: ['sgnl_previous'],
      interpretationIds: ['intp_previous'],
      claimIds: ['clm_prev'],
      candidateIds: ['cand_previous'],
      corroborationStrength: 'weak',
      corroborationReasoning: 'Single source',
      sourceCount: 1,
      status: 'gathering',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };

    // Mock: existing pack found
    mockSend.mockResolvedValueOnce({ Items: [existingPack] });
    // Mock: update pack
    mockSend.mockResolvedValueOnce({});
    // Mock: update candidate with packId
    mockSend.mockResolvedValueOnce({});

    const input: PackBuilderInput = {
      signalId: 'sgnl_new12345',
      interpretationId: 'intp_new67890',
      claims: [
        { claimId: 'clm_new1', claimType: 'event_exists', subject: 'Stingray Live' },
        { claimId: 'clm_new2', claimType: 'event_date', value: '2026-05-15' },
      ],
      eventCandidates: [
        {
          candidateId: 'cand_new12345',
          proposedName: 'Stingray Live',
          proposedDate: '2026-05-15',
          proposedVenueName: 'The Rigger',
          proposedArtistNames: ['Stingray'],
          sourceClaimIds: ['clm_new1', 'clm_new2'],
        },
      ],
    };

    const result = await handler(input);

    expect(result.packIds).toContain('pack_existing');
    expect(result.candidatePackLinks[0].packId).toBe('pack_existing');
  });
});
