import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted for proper mock hoisting
const { mockSend, mockGetSignedUrl } = vi.hoisted(() => {
  process.env.SIGNALS_BUCKET = 'test-bucket';
  process.env.SIGNALS_TABLE = 'test-signals-table';
  return {
    mockSend: vi.fn(),
    mockGetSignedUrl: vi.fn(),
  };
});

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({})),
  GetObjectCommand: vi.fn((params) => ({ type: 'S3Get', params })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  GetCommand: vi.fn((params) => ({ type: 'Get', params })),
  QueryCommand: vi.fn((params) => ({ type: 'Query', params })),
  BatchGetCommand: vi.fn((params) => ({ type: 'BatchGet', params })),
}));

import { handler } from './index';

describe('signal-get handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://presigned-url.example.com');
  });

  it('should return 400 for missing signalId', async () => {
    const event = { pathParameters: {} } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result!.body)).toEqual({ error: 'Missing signalId parameter' });
  });

  it('should return 400 for invalid signalId format', async () => {
    const event = { pathParameters: { signalId: 'invalid' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result!.body)).toEqual({ error: 'Invalid signalId format' });
  });

  it('should return 404 for non-existent signal', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const event = { pathParameters: { signalId: 'sgnl_test1234' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(404);
    expect(JSON.parse(result!.body)).toEqual({ error: 'Signal not found' });
  });

  it('should return signal without interpretation or clarifications', async () => {
    const signal = {
      signalId: 'sgnl_test1234',
      status: 'received',
      contentType: 'text/plain',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    // Get signal
    mockSend.mockResolvedValueOnce({ Item: signal });
    // Query claims (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Query direct clarifications by signal (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = { pathParameters: { signalId: 'sgnl_test1234' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.signal).toEqual(signal);
    expect(body.interpretation).toBeUndefined();
    expect(body.claims).toEqual([]);
    expect(body.clarifications).toEqual([]);
  });

  it('should return signal with interpretation but no clarifications', async () => {
    const signal = {
      signalId: 'sgnl_test1234',
      status: 'pending_review',
      contentType: 'text/plain',
      currentInterpretationId: 'intp_abcd1234',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    const interpretation = {
      interpretationId: 'intp_abcd1234',
      signalId: 'sgnl_test1234',
      summary: 'Event announcement',
      createdAt: '2026-05-04T12:01:00.000Z',
      // No eventCandidateIds
    };

    const claims = [
      { claimId: 'clm_abc12345', type: 'event_exists', subject: 'Stingray Live' },
    ];

    // Get signal
    mockSend.mockResolvedValueOnce({ Item: signal });
    // Get interpretation
    mockSend.mockResolvedValueOnce({ Item: interpretation });
    // Query claims (GSI2)
    mockSend.mockResolvedValueOnce({ Items: claims });
    // Query direct clarifications by signal (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = { pathParameters: { signalId: 'sgnl_test1234' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.signal).toEqual(signal);
    expect(body.interpretation).toEqual(interpretation);
    expect(body.claims).toEqual(claims);
    expect(body.clarifications).toEqual([]);
  });

  it('should return clarifications from candidates when interpretation has eventCandidateIds', async () => {
    const signal = {
      signalId: 'sgnl_test1234',
      status: 'pending_review',
      contentType: 'text/plain',
      currentInterpretationId: 'intp_abcd1234',
      createdAt: '2026-05-04T12:00:00.000Z',
    };

    const interpretation = {
      interpretationId: 'intp_abcd1234',
      signalId: 'sgnl_test1234',
      summary: 'Event announcement',
      eventCandidateIds: ['cand_xyz12345'],
      createdAt: '2026-05-04T12:01:00.000Z',
    };

    const candidate = {
      candidateId: 'cand_xyz12345',
      proposedName: 'Stingray Live',
      clarificationIds: ['clar_abc12345'],
    };

    const clarification = {
      clarificationId: 'clar_abc12345',
      candidateId: 'cand_xyz12345',
      question: 'Which venue is "The Rigger"?',
      questionType: 'entity_match',
      options: [
        { optionId: 'opt_venue001', label: 'The Rigger, Newcastle', entityId: 'vnue_ncl12345' },
        { optionId: 'opt_venue002', label: 'The Rigger, Sheffield', entityId: 'vnue_shf67890' },
      ],
      status: 'open',
      createdAt: '2026-05-04T12:02:00.000Z',
    };

    // Get signal
    mockSend.mockResolvedValueOnce({ Item: signal });
    // Get interpretation
    mockSend.mockResolvedValueOnce({ Item: interpretation });
    // Query claims (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Parallel: Query direct clarifications by signal (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Parallel: BatchGet candidates
    mockSend.mockResolvedValueOnce({
      Responses: { 'test-signals-table': [candidate] },
    });
    // BatchGet clarifications
    mockSend.mockResolvedValueOnce({
      Responses: { 'test-signals-table': [clarification] },
    });

    const event = { pathParameters: { signalId: 'sgnl_test1234' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.clarifications).toHaveLength(1);
    expect(body.clarifications[0].clarificationId).toBe('clar_abc12345');
    expect(body.clarifications[0].question).toBe('Which venue is "The Rigger"?');
    expect(body.clarifications[0].options).toHaveLength(2);
  });

  it('should only return open clarifications, not resolved ones', async () => {
    const signal = {
      signalId: 'sgnl_test1234',
      status: 'pending_review',
      currentInterpretationId: 'intp_abcd1234',
    };

    const interpretation = {
      interpretationId: 'intp_abcd1234',
      eventCandidateIds: ['cand_xyz12345'],
    };

    const candidate = {
      candidateId: 'cand_xyz12345',
      clarificationIds: ['clar_open1234', 'clar_resolved1'],
    };

    const openClarification = {
      clarificationId: 'clar_open1234',
      candidateId: 'cand_xyz12345',
      question: 'Which venue?',
      questionType: 'entity_match',
      options: [],
      status: 'open',
    };

    const resolvedClarification = {
      clarificationId: 'clar_resolved1',
      candidateId: 'cand_xyz12345',
      question: 'Which date?',
      questionType: 'date_confirm',
      options: [],
      status: 'resolved',
      resolution: '2026-05-15',
    };

    // Get signal
    mockSend.mockResolvedValueOnce({ Item: signal });
    // Get interpretation
    mockSend.mockResolvedValueOnce({ Item: interpretation });
    // Query claims (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Parallel: Query direct clarifications by signal (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Parallel: BatchGet candidates
    mockSend.mockResolvedValueOnce({
      Responses: { 'test-signals-table': [candidate] },
    });
    // BatchGet clarifications
    mockSend.mockResolvedValueOnce({
      Responses: { 'test-signals-table': [openClarification, resolvedClarification] },
    });

    const event = { pathParameters: { signalId: 'sgnl_test1234' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.clarifications).toHaveLength(1);
    expect(body.clarifications[0].clarificationId).toBe('clar_open1234');
    expect(body.clarifications[0].status).toBe('open');
  });

  it('should return empty clarifications when candidates have no clarificationIds', async () => {
    const signal = {
      signalId: 'sgnl_test1234',
      currentInterpretationId: 'intp_abcd1234',
    };

    const interpretation = {
      interpretationId: 'intp_abcd1234',
      eventCandidateIds: ['cand_xyz12345'],
    };

    const candidate = {
      candidateId: 'cand_xyz12345',
      proposedName: 'Clear event - no ambiguities',
      // No clarificationIds
    };

    // Get signal
    mockSend.mockResolvedValueOnce({ Item: signal });
    // Get interpretation
    mockSend.mockResolvedValueOnce({ Item: interpretation });
    // Query claims (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Parallel: Query direct clarifications by signal (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Parallel: BatchGet candidates
    mockSend.mockResolvedValueOnce({
      Responses: { 'test-signals-table': [candidate] },
    });

    const event = { pathParameters: { signalId: 'sgnl_test1234' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.clarifications).toEqual([]);
  });

  it('should handle multiple candidates with clarifications', async () => {
    const signal = {
      signalId: 'sgnl_test1234',
      currentInterpretationId: 'intp_abcd1234',
    };

    const interpretation = {
      interpretationId: 'intp_abcd1234',
      eventCandidateIds: ['cand_event001', 'cand_event002'],
    };

    const candidates = [
      {
        candidateId: 'cand_event001',
        proposedName: 'Event 1',
        clarificationIds: ['clar_event1_q'],
      },
      {
        candidateId: 'cand_event002',
        proposedName: 'Event 2',
        clarificationIds: ['clar_event2_q'],
      },
    ];

    const clarifications = [
      {
        clarificationId: 'clar_event1_q',
        candidateId: 'cand_event001',
        question: 'Q1?',
        questionType: 'entity_match',
        options: [],
        status: 'open',
      },
      {
        clarificationId: 'clar_event2_q',
        candidateId: 'cand_event002',
        question: 'Q2?',
        questionType: 'date_confirm',
        options: [],
        status: 'open',
      },
    ];

    // Get signal
    mockSend.mockResolvedValueOnce({ Item: signal });
    // Get interpretation
    mockSend.mockResolvedValueOnce({ Item: interpretation });
    // Query claims (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Parallel: Query direct clarifications by signal (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Parallel: BatchGet candidates
    mockSend.mockResolvedValueOnce({
      Responses: { 'test-signals-table': candidates },
    });
    // BatchGet clarifications
    mockSend.mockResolvedValueOnce({
      Responses: { 'test-signals-table': clarifications },
    });

    const event = { pathParameters: { signalId: 'sgnl_test1234' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.clarifications).toHaveLength(2);
    expect(body.clarifications.map((c: any) => c.clarificationId)).toContain('clar_event1_q');
    expect(body.clarifications.map((c: any) => c.clarificationId)).toContain('clar_event2_q');
  });

  it('should return presigned URL for raw content', async () => {
    const signal = {
      signalId: 'sgnl_test1234',
      rawContentS3Key: 'raw/sgnl_test1234/content.txt',
    };

    mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/presigned');
    // Get signal
    mockSend.mockResolvedValueOnce({ Item: signal });
    // Query claims (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Query direct clarifications by signal (GSI2)
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = { pathParameters: { signalId: 'sgnl_test1234' } } as any;
    const result = await handler(event, {} as any, vi.fn());

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.rawContentUrl).toBe('https://s3.example.com/presigned');
  });
});
