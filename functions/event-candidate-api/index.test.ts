import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  GetCommand: class GetCommand {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class UpdateCommand {
    constructor(public input: unknown) {}
  },
  PutCommand: class PutCommand {
    constructor(public input: unknown) {}
  },
  QueryCommand: class QueryCommand {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class DynamoDBClient {},
}));

import { handler } from './index';

const createEvent = (
  method: string,
  path: string,
  pathParameters?: Record<string, string>,
  body?: object
): APIGatewayProxyEvent => ({
  httpMethod: method,
  path,
  pathParameters: pathParameters || null,
  body: body ? JSON.stringify(body) : null,
  headers: {},
  multiValueHeaders: {},
  isBase64Encoded: false,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {} as any,
  resource: '',
});

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:eu-west-2:123:function:test',
  memoryLimitInMB: '256',
  awsRequestId: 'test-request-id',
  logGroupName: 'test-log-group',
  logStreamName: 'test-log-stream',
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

const validCandidate = {
  candidateId: 'cand_abc12345',
  candidateType: 'event',
  signalId: 'sgnl_xyz98765',
  interpretationId: 'intp_def45678',
  proposedName: 'Stingray Live at The Rigger',
  proposedDate: '2026-05-15',
  proposedTime: '20:00',
  proposedVenueId: 'vnue_abc12345',
  proposedArtistIds: ['arts_xyz98765'],
  sourceClaims: [
    { claimId: 'clm_claim001', claimType: 'event_exists', value: 'Stingray Live', status: 'proposed' },
  ],
  completeness: 'complete',
  missingFields: [],
  ambiguities: [],
  verificationStatus: 'unverified',
  status: 'proposed',
  createdAt: '2026-05-04T10:00:00.000Z',
  updatedAt: '2026-05-04T10:00:00.000Z',
};

describe('event-candidate-api handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNALS_TABLE = 'test-table';
  });

  describe('GET /candidates', () => {
    it('returns list of proposed candidates', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { ...validCandidate, PK: 'CANDIDATE#cand_abc12345', SK: '#METADATA' },
        ],
      });

      const event = createEvent('GET', '/candidates');

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(200);
      const body = JSON.parse(result?.body || '{}');
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0].candidateId).toBe('cand_abc12345');
    });

    it('returns empty list when no candidates', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent('GET', '/candidates');

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(200);
      const body = JSON.parse(result?.body || '{}');
      expect(body.candidates).toEqual([]);
    });
  });

  describe('GET /candidates/{candidateId}', () => {
    it('returns candidate details', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { ...validCandidate, PK: 'CANDIDATE#cand_abc12345', SK: '#METADATA' },
      });

      const event = createEvent('GET', '/candidates/cand_abc12345', { candidateId: 'cand_abc12345' });

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(200);
      const body = JSON.parse(result?.body || '{}');
      expect(body.candidateId).toBe('cand_abc12345');
      expect(body.proposedName).toBe('Stingray Live at The Rigger');
    });

    it('returns 404 when candidate not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = createEvent('GET', '/candidates/cand_notfound', { candidateId: 'cand_notfound' });

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(404);
    });
  });

  describe('POST /candidates/{candidateId}/ratify', () => {
    it('creates canonical event from ratified candidate', async () => {
      // Mock GetCommand for candidate lookup
      mockSend.mockResolvedValueOnce({
        Item: { ...validCandidate, PK: 'CANDIDATE#cand_abc12345', SK: '#METADATA' },
      });

      // Mock UpdateCommand for candidate status
      mockSend.mockResolvedValueOnce({});

      // Mock PutCommand for creating canonical event
      let createdEvent: any;
      mockSend.mockImplementationOnce((cmd: any) => {
        createdEvent = cmd.input?.Item;
        return Promise.resolve({});
      });

      const event = createEvent('POST', '/candidates/cand_abc12345/ratify', { candidateId: 'cand_abc12345' });

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(200);
      const body = JSON.parse(result?.body || '{}');
      expect(body.action).toBe('ratified');
      expect(body.eventId).toMatch(/^evnt_[a-zA-Z0-9]{8}$/);
      expect(createdEvent?.name).toBe('Stingray Live at The Rigger');
      expect(createdEvent?.venueId).toBe('vnue_abc12345');
      expect(createdEvent?.artistIds).toContain('arts_xyz98765');
    });

    it('returns 400 when candidate has unresolved ambiguities', async () => {
      const candidateWithAmbiguity = {
        ...validCandidate,
        proposedVenueId: undefined,
        ambiguities: [
          { ambiguityType: 'entity_match', description: 'Multiple venues match', affectedClaimIds: [] },
        ],
      };

      mockSend.mockResolvedValueOnce({
        Item: { ...candidateWithAmbiguity, PK: 'CANDIDATE#cand_abc12345', SK: '#METADATA' },
      });

      const event = createEvent('POST', '/candidates/cand_abc12345/ratify', { candidateId: 'cand_abc12345' });

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(400);
      const body = JSON.parse(result?.body || '{}');
      expect(body.error).toContain('ambiguities');
    });

    it('returns 400 when candidate is incomplete', async () => {
      const incompleteCandidate = {
        ...validCandidate,
        completeness: 'partial',
        missingFields: ['venue'],
        proposedVenueId: undefined,
      };

      mockSend.mockResolvedValueOnce({
        Item: { ...incompleteCandidate, PK: 'CANDIDATE#cand_abc12345', SK: '#METADATA' },
      });

      const event = createEvent('POST', '/candidates/cand_abc12345/ratify', { candidateId: 'cand_abc12345' });

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(400);
      const body = JSON.parse(result?.body || '{}');
      expect(body.error).toContain('incomplete');
    });

    it('returns 404 when candidate not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = createEvent('POST', '/candidates/cand_notfound/ratify', { candidateId: 'cand_notfound' });

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(404);
    });
  });

  describe('POST /candidates/{candidateId}/reject', () => {
    it('rejects candidate with reason', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { ...validCandidate, PK: 'CANDIDATE#cand_abc12345', SK: '#METADATA' },
      });

      mockSend.mockResolvedValueOnce({});

      const event = createEvent(
        'POST',
        '/candidates/cand_abc12345/reject',
        { candidateId: 'cand_abc12345' },
        { reason: 'Duplicate event' }
      );

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(200);
      const body = JSON.parse(result?.body || '{}');
      expect(body.action).toBe('rejected');
      expect(body.candidateId).toBe('cand_abc12345');
    });

    it('requires reason for rejection', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { ...validCandidate, PK: 'CANDIDATE#cand_abc12345', SK: '#METADATA' },
      });

      const event = createEvent(
        'POST',
        '/candidates/cand_abc12345/reject',
        { candidateId: 'cand_abc12345' },
        {}
      );

      const result = await handler(event, mockContext, () => {});

      expect(result?.statusCode).toBe(400);
      const body = JSON.parse(result?.body || '{}');
      expect(body.error).toContain('reason');
    });
  });
});
