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
  GetCommand: vi.fn((params) => ({ type: 'Get', params })),
  QueryCommand: vi.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: vi.fn((params) => ({ type: 'Update', params })),
}));

// Capture UpdateCommand calls for verification
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Import after mocks
import { handler, resolveClarification, dismissClarification } from './index';

describe('resolveClarification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve clarification with selected entity option', async () => {
    const clarification = {
      clarificationId: 'clar_test1234',
      candidateId: 'cand_xyz12345',
      question: 'Which venue is this?',
      questionType: 'entity_match',
      options: [
        { optionId: 'opt_selected1', label: 'The Rigger, Newcastle', entityId: 'vnue_ncl12345' },
        { optionId: 'opt_other123', label: 'The Rigger, Sheffield', entityId: 'vnue_shf67890' },
      ],
      status: 'open',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    // Get clarification
    mockSend.mockResolvedValueOnce({ Item: clarification });
    // Update clarification
    mockSend.mockResolvedValueOnce({});
    // Get candidate to update
    mockSend.mockResolvedValueOnce({
      Item: {
        candidateId: 'cand_xyz12345',
        proposedName: 'Stingray Live',
        proposedVenueName: 'The Rigger',
        status: 'proposed',
      },
    });
    // Update candidate with resolved venueId
    mockSend.mockResolvedValueOnce({});

    const result = await resolveClarification({
      clarificationId: 'clar_test1234',
      selectedOptionId: 'opt_selected1',
      resolvedBy: 'user_123',
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('vnue_ncl12345');
  });

  it('should fail if clarification not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await resolveClarification({
      clarificationId: 'clar_notfound',
      selectedOptionId: 'opt_selected1',
      resolvedBy: 'user_123',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should fail if clarification already resolved', async () => {
    const clarification = {
      clarificationId: 'clar_resolved',
      status: 'resolved',
      resolvedAt: '2026-05-04T13:00:00.000Z',
    };

    mockSend.mockResolvedValueOnce({ Item: clarification });

    const result = await resolveClarification({
      clarificationId: 'clar_resolved',
      selectedOptionId: 'opt_selected1',
      resolvedBy: 'user_123',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already resolved');
  });

  it('should fail if selected option not found', async () => {
    const clarification = {
      clarificationId: 'clar_test1234',
      options: [
        { optionId: 'opt_existing1', label: 'Option 1' },
      ],
      status: 'open',
    };

    mockSend.mockResolvedValueOnce({ Item: clarification });

    const result = await resolveClarification({
      clarificationId: 'clar_test1234',
      selectedOptionId: 'opt_nonexist',
      resolvedBy: 'user_123',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should resolve with free-form text when no options and freeformValue provided', async () => {
    const clarification = {
      clarificationId: 'clar_time1234',
      candidateId: 'cand_xyz12345',
      question: 'What time does this event start?',
      questionType: 'event_time',
      options: [], // No options - free-form expected
      status: 'open',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    // Get clarification
    mockSend.mockResolvedValueOnce({ Item: clarification });
    // Update clarification
    mockSend.mockResolvedValueOnce({});
    // Get candidate to update
    mockSend.mockResolvedValueOnce({
      Item: {
        candidateId: 'cand_xyz12345',
        proposedName: 'Stingray Live',
        proposedDate: '2026-05-15',
        status: 'proposed',
      },
    });
    // Update candidate with time
    mockSend.mockResolvedValueOnce({});

    const result = await resolveClarification({
      clarificationId: 'clar_time1234',
      freeformValue: '21:00',
      resolvedBy: 'user_123',
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('21:00');
  });

  it('should normalise time input (9 -> 21:00 for PM assumption)', async () => {
    const clarification = {
      clarificationId: 'clar_time1234',
      candidateId: 'cand_xyz12345',
      question: 'What time does this event start?',
      questionType: 'event_time',
      options: [],
      status: 'open',
    };

    mockSend.mockResolvedValueOnce({ Item: clarification });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({
      Item: { candidateId: 'cand_xyz12345', proposedName: 'Test Event' },
    });
    mockSend.mockResolvedValueOnce({});

    const result = await resolveClarification({
      clarificationId: 'clar_time1234',
      freeformValue: '9',
      resolvedBy: 'user_123',
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('21:00'); // Assumes PM for grassroots gigs
  });

  it('should remove resolved ambiguity and recalculate completeness', async () => {
    const clarification = {
      clarificationId: 'clar_test1234',
      candidateId: 'cand_abcd1234',
      question: 'Which venue is this?',
      questionType: 'entity_match',
      options: [
        { optionId: 'opt_selected1', label: 'The Rigger, Newcastle', entityId: 'vnue_ncl12345' },
        { optionId: 'opt_other123', label: 'The Rigger, Sheffield', entityId: 'vnue_shf67890' },
      ],
      status: 'open',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    const candidate = {
      candidateId: 'cand_abcd1234',
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedArtistIds: ['arts_xyz12345'],
      // No proposedVenueId - this is the ambiguity
      ambiguities: [
        {
          ambiguityType: 'entity_match',
          description: 'Multiple venues match "The Rigger"',
          affectedClaimIds: ['clm_venue123'],
        },
      ],
      completeness: 'partial',
      missingFields: ['venue'],
      status: 'proposed',
    };

    // Get clarification
    mockSend.mockResolvedValueOnce({ Item: clarification });
    // Update clarification status
    mockSend.mockResolvedValueOnce({});
    // Get candidate to update
    mockSend.mockResolvedValueOnce({ Item: candidate });
    // Update candidate with resolved data
    mockSend.mockResolvedValueOnce({});

    const result = await resolveClarification({
      clarificationId: 'clar_test1234',
      selectedOptionId: 'opt_selected1',
      resolvedBy: 'user_123',
    });

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('vnue_ncl12345');

    // Verify the candidate update was called with correct params
    const updateCalls = mockSend.mock.calls.filter(
      (call) => call[0].type === 'Update'
    );

    // Second Update should be the candidate update
    const candidateUpdateCall = updateCalls[1];
    expect(candidateUpdateCall).toBeDefined();

    const candidateUpdateParams = candidateUpdateCall[0].params;
    expect(candidateUpdateParams.Key).toEqual({
      PK: 'CANDIDATE#cand_abcd1234',
      SK: '#METADATA',
    });

    // Check that venue was resolved
    expect(candidateUpdateParams.ExpressionAttributeValues[':venueId']).toBe('vnue_ncl12345');
    // Check that ambiguities were cleared
    expect(candidateUpdateParams.ExpressionAttributeValues[':ambiguities']).toEqual([]);
    // Check that completeness was recalculated to 'complete'
    expect(candidateUpdateParams.ExpressionAttributeValues[':completeness']).toBe('complete');
    expect(candidateUpdateParams.ExpressionAttributeValues[':missingFields']).toEqual([]);
  });

  it('should update evidence pack when candidate has evidencePackId', async () => {
    const clarification = {
      clarificationId: 'clar_test1234',
      candidateId: 'cand_abcd1234',
      questionType: 'entity_match',
      options: [
        { optionId: 'opt_selected1', label: 'The Rigger', entityId: 'vnue_ncl12345' },
      ],
      status: 'open',
    };

    const candidate = {
      candidateId: 'cand_abcd1234',
      proposedName: 'Stingray Live',
      proposedDate: '2026-05-15',
      proposedArtistIds: ['arts_xyz12345'],
      ambiguities: [
        { ambiguityType: 'entity_match', description: 'Venue ambiguous', affectedClaimIds: [] },
      ],
      completeness: 'partial',
      missingFields: ['venue'],
      evidencePackId: 'pack_abcd1234', // Has evidence pack
      status: 'proposed',
    };

    // Get clarification
    mockSend.mockResolvedValueOnce({ Item: clarification });
    // Update clarification status
    mockSend.mockResolvedValueOnce({});
    // Get candidate
    mockSend.mockResolvedValueOnce({ Item: candidate });
    // Update candidate
    mockSend.mockResolvedValueOnce({});
    // Update evidence pack
    mockSend.mockResolvedValueOnce({});

    const result = await resolveClarification({
      clarificationId: 'clar_test1234',
      selectedOptionId: 'opt_selected1',
      resolvedBy: 'user_123',
    });

    expect(result.success).toBe(true);

    // Verify the evidence pack was updated
    const updateCalls = mockSend.mock.calls.filter(
      (call) => call[0].type === 'Update'
    );

    // Third Update should be the pack update
    expect(updateCalls.length).toBe(3);
    const packUpdateCall = updateCalls[2];
    expect(packUpdateCall[0].params.Key).toEqual({
      PK: 'PACK#pack_abcd1234',
      SK: '#METADATA',
    });
  });
});

describe('dismissClarification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dismiss clarification without resolution', async () => {
    const clarification = {
      clarificationId: 'clar_test1234',
      candidateId: 'cand_xyz12345',
      status: 'open',
    };

    // Get clarification
    mockSend.mockResolvedValueOnce({ Item: clarification });
    // Update clarification
    mockSend.mockResolvedValueOnce({});

    const result = await dismissClarification({
      clarificationId: 'clar_test1234',
      dismissedBy: 'user_123',
      reason: 'Not relevant',
    });

    expect(result.success).toBe(true);
  });

  it('should fail if clarification already resolved', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { clarificationId: 'clar_test1234', status: 'resolved' },
    });

    const result = await dismissClarification({
      clarificationId: 'clar_test1234',
      dismissedBy: 'user_123',
    });

    expect(result.success).toBe(false);
  });
});

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route resolve action to resolveClarification', async () => {
    const clarification = {
      clarificationId: 'clar_test1234',
      candidateId: 'cand_xyz12345',
      questionType: 'entity_match',
      options: [
        { optionId: 'opt_selected1', label: 'Venue A', entityId: 'vnue_abc12345' },
      ],
      status: 'open',
    };

    mockSend.mockResolvedValueOnce({ Item: clarification });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({
      Item: { candidateId: 'cand_xyz12345', proposedVenueName: 'Venue A' },
    });
    mockSend.mockResolvedValueOnce({});

    const event = {
      pathParameters: { clarificationId: 'clar_test1234' },
      body: JSON.stringify({
        action: 'resolve',
        selectedOptionId: 'opt_selected1',
        resolvedBy: 'user_123',
      }),
    };

    const result = await handler(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
  });

  it('should route dismiss action to dismissClarification', async () => {
    const clarification = {
      clarificationId: 'clar_test1234',
      status: 'open',
    };

    mockSend.mockResolvedValueOnce({ Item: clarification });
    mockSend.mockResolvedValueOnce({});

    const event = {
      pathParameters: { clarificationId: 'clar_test1234' },
      body: JSON.stringify({
        action: 'dismiss',
        dismissedBy: 'user_123',
        reason: 'Not relevant',
      }),
    };

    const result = await handler(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
  });

  it('should return 404 for missing clarification', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const event = {
      pathParameters: { clarificationId: 'clar_notfound' },
      body: JSON.stringify({
        action: 'resolve',
        selectedOptionId: 'opt_any12345',
        resolvedBy: 'user_123',
      }),
    };

    const result = await handler(event as any);

    expect(result.statusCode).toBe(404);
  });

  it('should return 400 for invalid action', async () => {
    const event = {
      pathParameters: { clarificationId: 'clar_test1234' },
      body: JSON.stringify({ action: 'invalid' }),
    };

    const result = await handler(event as any);

    expect(result.statusCode).toBe(400);
  });
});
