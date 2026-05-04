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
