import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted for proper mock hoisting
const { mockSend } = vi.hoisted(() => {
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
  BatchWriteCommand: vi.fn((params) => ({ type: 'BatchWrite', params })),
}));

// Import after mocks
import {
  handler,
  generateClarificationsFromCandidate,
  ClarificationGeneratorInput,
  ClarificationGeneratorOutput,
} from './index';

describe('generateClarificationsFromCandidate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate entity_match clarification for venue ambiguity', async () => {
    const candidate = {
      candidateId: 'cand_test1234',
      proposedName: 'Stingray Live',
      proposedVenueName: 'The Rigger',
      ambiguities: [
        {
          ambiguityType: 'entity_match' as const,
          description: 'Multiple venues match "The Rigger"',
          affectedClaimIds: ['clm_venue123'],
        },
      ],
    };

    const venueMatches = [
      { entityId: 'vnue_ncl12345', name: 'The Rigger', city: 'Newcastle-under-Lyme' },
      { entityId: 'vnue_shf67890', name: 'The Rigger', city: 'Sheffield' },
    ];

    mockSend.mockResolvedValueOnce({ Items: venueMatches });
    mockSend.mockResolvedValueOnce({}); // Put clarification

    const result = await generateClarificationsFromCandidate(candidate);

    expect(result.length).toBe(1);
    expect(result[0].questionType).toBe('entity_match');
    expect(result[0].candidateId).toBe('cand_test1234');
    expect(result[0].options.length).toBe(2);
  });

  it('should generate date_confirm clarification for date ambiguity', async () => {
    const candidate = {
      candidateId: 'cand_test1234',
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      ambiguities: [
        {
          ambiguityType: 'date_uncertain' as const,
          description: 'Year inferred from current date',
          affectedClaimIds: ['clm_date1234'],
        },
      ],
    };

    mockSend.mockResolvedValueOnce({}); // Put clarification

    const result = await generateClarificationsFromCandidate(candidate);

    expect(result.length).toBe(1);
    expect(result[0].questionType).toBe('date_confirm');
    expect(result[0].question).toContain('2026-05-15');
  });

  it('should return empty array for candidate with no ambiguities', async () => {
    const candidate = {
      candidateId: 'cand_test1234',
      proposedName: 'Stingray Live',
      ambiguities: [],
    };

    const result = await generateClarificationsFromCandidate(candidate);

    expect(result.length).toBe(0);
  });

  it('should generate multiple clarifications for multiple ambiguities', async () => {
    const candidate = {
      candidateId: 'cand_test1234',
      proposedName: 'Stingray Live',
      proposedVenueName: 'The Rigger',
      proposedDate: '2026-05-15',
      ambiguities: [
        {
          ambiguityType: 'entity_match' as const,
          description: 'Multiple venues match "The Rigger"',
          affectedClaimIds: ['clm_venue123'],
        },
        {
          ambiguityType: 'date_uncertain' as const,
          description: 'Year inferred',
          affectedClaimIds: ['clm_date1234'],
        },
      ],
    };

    // First query for venues
    mockSend.mockResolvedValueOnce({ Items: [
      { entityId: 'vnue_ncl12345', name: 'The Rigger', city: 'Newcastle' },
    ] });
    // Put first clarification
    mockSend.mockResolvedValueOnce({});
    // Put second clarification
    mockSend.mockResolvedValueOnce({});

    const result = await generateClarificationsFromCandidate(candidate);

    expect(result.length).toBe(2);
    expect(result[0].questionType).toBe('entity_match');
    expect(result[1].questionType).toBe('date_confirm');
  });
});

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process multiple candidates and generate clarifications', async () => {
    const input: ClarificationGeneratorInput = {
      signalId: 'sgnl_test1234',
      interpretationId: 'intp_test5678',
      candidates: [
        {
          candidateId: 'cand_abcd1234',
          proposedName: 'Stingray Live',
          proposedVenueName: 'The Rigger',
          ambiguities: [
            {
              ambiguityType: 'entity_match' as const,
              description: 'Multiple venues match',
              affectedClaimIds: [],
            },
          ],
        },
      ],
    };

    // Query venues
    mockSend.mockResolvedValueOnce({ Items: [
      { entityId: 'vnue_test1234', name: 'The Rigger', city: 'Test City' },
    ] });
    // Put clarification
    mockSend.mockResolvedValueOnce({});
    // Update candidate with clarificationIds
    mockSend.mockResolvedValueOnce({});

    const result = await handler(input);

    expect(result.clarificationIds.length).toBe(1);
    expect(result.clarificationIds[0]).toMatch(/^clar_[a-zA-Z0-9]{8}$/);
  });

  it('should return empty array when no ambiguities', async () => {
    const input: ClarificationGeneratorInput = {
      signalId: 'sgnl_test1234',
      interpretationId: 'intp_test5678',
      candidates: [
        {
          candidateId: 'cand_abcd1234',
          proposedName: 'Stingray Live',
          ambiguities: [],
        },
      ],
    };

    const result = await handler(input);

    expect(result.clarificationIds.length).toBe(0);
  });
});
