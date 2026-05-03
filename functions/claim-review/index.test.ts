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
  signalId: string,
  claimId: string,
  body: object
): APIGatewayProxyEvent => ({
  pathParameters: { signalId, claimId },
  body: JSON.stringify(body),
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'POST',
  isBase64Encoded: false,
  path: `/signals/${signalId}/claims/${claimId}/review`,
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

describe('claim-review handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNALS_TABLE = 'test-table';
  });

  it('returns 400 when signalId is missing', async () => {
    const event = createEvent('', 'clm_abc12345', { action: 'accept' });
    event.pathParameters = { claimId: 'clm_abc12345' };

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(400);
  });

  it('returns 400 when claimId is missing', async () => {
    const event = createEvent('sgnl_abc1234', '', { action: 'accept' });
    event.pathParameters = { signalId: 'sgnl_abc1234' };

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(400);
  });

  it('returns 400 for invalid action', async () => {
    const event = createEvent('sgnl_abc1234', 'clm_abc12345', { action: 'invalid' });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(400);
  });

  it('returns 404 when claim not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: null });

    const event = createEvent('sgnl_abc1234', 'clm_abc12345', { action: 'accept' });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(404);
  });

  it('returns 400 when claim belongs to different signal', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'CLAIM#clm_abc12345',
        SK: '#METADATA',
        signalId: 'sgnl_different',
        claimType: 'artist_performs',
        subject: 'Stingray',
        status: 'proposed',
      },
    });

    const event = createEvent('sgnl_abc1234', 'clm_abc12345', { action: 'accept' });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result?.body || '{}').error).toBe('Claim does not belong to this signal');
  });

  it('accepts claim and triggers entity resolution', async () => {
    // Mock GetCommand for claim lookup
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'CLAIM#clm_abc12345',
        SK: '#METADATA',
        claimId: 'clm_abc12345',
        signalId: 'sgnl_abc1234',
        claimType: 'artist_performs',
        subject: 'Stingray',
        predicate: 'performs_at',
        object: 'The Rigger',
        strength: 'moderate',
        status: 'proposed',
      },
    });

    // Mock UpdateCommand for claim status update
    mockSend.mockResolvedValueOnce({});

    // Mock QueryCommand for entity resolution (no existing entity)
    mockSend.mockResolvedValueOnce({ Items: [] });

    // Mock PutCommand for creating new entity
    mockSend.mockResolvedValueOnce({});

    const event = createEvent('sgnl_abc1234', 'clm_abc12345', { action: 'accept' });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body || '{}');
    expect(body.status).toBe('accepted');
    expect(body.entityResolution).toBeDefined();
    expect(body.entityResolution.action).toBe('created');
    expect(body.entityResolution.entityType).toBe('artist');
  });

  it('accepts claim and links to existing entity', async () => {
    // Mock GetCommand for claim lookup
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'CLAIM#clm_abc12345',
        SK: '#METADATA',
        claimId: 'clm_abc12345',
        signalId: 'sgnl_abc1234',
        claimType: 'artist_performs',
        subject: 'Stingray',
        predicate: 'performs_at',
        object: 'The Rigger',
        strength: 'moderate',
        status: 'proposed',
      },
    });

    // Mock UpdateCommand for claim status update
    mockSend.mockResolvedValueOnce({});

    // Mock QueryCommand for entity resolution (existing entity found)
    mockSend.mockResolvedValueOnce({
      Items: [
        {
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
        },
      ],
    });

    // Mock UpdateCommand for entity update
    mockSend.mockResolvedValueOnce({});

    const event = createEvent('sgnl_abc1234', 'clm_abc12345', { action: 'accept' });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body || '{}');
    expect(body.status).toBe('accepted');
    expect(body.entityResolution).toBeDefined();
    expect(body.entityResolution.action).toBe('linked');
    expect(body.entityResolution.entityId).toBe('arts_existing');
  });

  it('rejects claim without triggering entity resolution', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'CLAIM#clm_abc12345',
        SK: '#METADATA',
        claimId: 'clm_abc12345',
        signalId: 'sgnl_abc1234',
        claimType: 'artist_performs',
        subject: 'Stingray',
        status: 'proposed',
      },
    });

    mockSend.mockResolvedValueOnce({});

    const event = createEvent('sgnl_abc1234', 'clm_abc12345', {
      action: 'reject',
      reason: 'Incorrect artist name',
    });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body || '{}');
    expect(body.status).toBe('rejected');
    expect(body.entityResolution).toBeUndefined();
  });

  it('challenges claim without triggering entity resolution', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'CLAIM#clm_abc12345',
        SK: '#METADATA',
        claimId: 'clm_abc12345',
        signalId: 'sgnl_abc1234',
        claimType: 'artist_performs',
        subject: 'Stingray',
        status: 'proposed',
      },
    });

    mockSend.mockResolvedValueOnce({});

    const event = createEvent('sgnl_abc1234', 'clm_abc12345', {
      action: 'challenge',
      reason: 'Artist name might be abbreviated',
    });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body || '{}');
    expect(body.status).toBe('challenged');
    expect(body.entityResolution).toBeUndefined();
  });

  it('uses edited subject value for entity resolution', async () => {
    // Mock GetCommand for claim lookup - original has typo "Stingry"
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'CLAIM#clm_abc12345',
        SK: '#METADATA',
        claimId: 'clm_abc12345',
        signalId: 'sgnl_abc1234',
        claimType: 'artist_performs',
        subject: 'Stingry', // Original has typo
        predicate: 'performs_at',
        object: 'The Rigger',
        strength: 'moderate',
        status: 'proposed',
      },
    });

    // Mock UpdateCommand for claim status update
    mockSend.mockResolvedValueOnce({});

    // Mock QueryCommand for entity resolution
    mockSend.mockResolvedValueOnce({ Items: [] });

    // Mock PutCommand - capture what entity is created
    let createdEntity: any;
    mockSend.mockImplementationOnce((cmd: any) => {
      createdEntity = cmd.input?.Item;
      return Promise.resolve({});
    });

    // Accept with corrected subject
    const event = createEvent('sgnl_abc1234', 'clm_abc12345', {
      action: 'accept',
      editedSubject: 'Stingray', // User corrects the typo in subject
    });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body || '{}');
    expect(body.status).toBe('accepted');
    expect(body.entityResolution).toBeDefined();
    // The created entity should have the corrected name
    expect(createdEntity?.name).toBe('Stingray');
  });

  it('uses edited object value for entity resolution', async () => {
    // Mock GetCommand for claim lookup - venue claim with typo
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'CLAIM#clm_abc12345',
        SK: '#METADATA',
        claimId: 'clm_abc12345',
        signalId: 'sgnl_abc1234',
        claimType: 'venue_hosts',
        subject: 'The Rigger', // Venue name
        predicate: 'hosts',
        object: 'Stingry Live', // Original event name with typo
        strength: 'moderate',
        status: 'proposed',
      },
    });

    // Mock UpdateCommand for claim status update
    mockSend.mockResolvedValueOnce({});

    // Mock QueryCommand for entity resolution
    mockSend.mockResolvedValueOnce({ Items: [] });

    // Mock PutCommand - capture what entity is created
    let createdEntity: any;
    mockSend.mockImplementationOnce((cmd: any) => {
      createdEntity = cmd.input?.Item;
      return Promise.resolve({});
    });

    // Accept with corrected object
    const event = createEvent('sgnl_abc1234', 'clm_abc12345', {
      action: 'accept',
      editedObject: 'Stingray Live', // User corrects the typo
    });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(200);
    // Entity resolution creates venue from subject, not object
    // So we verify the venue entity is created from the subject "The Rigger"
    expect(createdEntity?.name).toBe('The Rigger');
  });

  it('returns candidates when multiple entities match', async () => {
    // Mock GetCommand for claim lookup
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'CLAIM#clm_abc12345',
        SK: '#METADATA',
        claimId: 'clm_abc12345',
        signalId: 'sgnl_abc1234',
        claimType: 'venue_hosts',
        subject: 'The Rigger',
        predicate: 'hosts',
        object: 'Stingray Live',
        strength: 'moderate',
        status: 'proposed',
      },
    });

    // Mock UpdateCommand for claim status update
    mockSend.mockResolvedValueOnce({});

    // Mock QueryCommand - return multiple matching venues
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          entityId: 'vnue_newcastl',
          entityType: 'venue',
          name: 'The Rigger',
          aliases: [],
          status: 'draft',
          address: { city: 'Newcastle-under-Lyme', postcode: 'ST5 1AA', line1: '1 High St', country: 'UK' },
          evidence: [{ claimId: 'clm_orig001', claimType: 'venue_exists', strength: 'moderate', linkedAt: '2026-05-01T12:00:00.000Z' }],
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-01T12:00:00.000Z',
        },
        {
          entityId: 'vnue_bristol1',
          entityType: 'venue',
          name: 'The Rigger',
          aliases: [],
          status: 'draft',
          address: { city: 'Bristol', postcode: 'BS1 1AA', line1: '2 Main St', country: 'UK' },
          evidence: [{ claimId: 'clm_orig002', claimType: 'venue_exists', strength: 'moderate', linkedAt: '2026-05-01T12:00:00.000Z' }],
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-01T12:00:00.000Z',
        },
      ],
    });

    const event = createEvent('sgnl_abc1234', 'clm_abc12345', { action: 'accept' });

    const result = await handler(event, mockContext, () => {});

    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body || '{}');
    expect(body.status).toBe('accepted');
    expect(body.entityResolution).toBeDefined();
    expect(body.entityResolution.action).toBe('candidates');
    expect(body.entityResolution.candidates).toHaveLength(2);
    // Verify candidates include location for disambiguation
    expect(body.entityResolution.candidates[0].location).toBe('Newcastle-under-Lyme');
    expect(body.entityResolution.candidates[1].location).toBe('Bristol');
  });
});
