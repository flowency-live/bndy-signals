/**
 * DynamoSourceStateStore Tests
 *
 * Tests for the DynamoDB implementation of SourceStateStore (resolution).
 * Table: bndy-source-state-{env}
 * PK: SOURCE#{sourceId}
 * SK: ENTITY#{entityType}#{sourceCanonicalKey}
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoSourceStateStore } from './DynamoSourceStateStore';
import { SourceStateEntry } from '../resolution/SourceStateStore';

// Mock AWS SDK
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  },
  GetCommand: vi.fn().mockImplementation((input) => ({ input })),
  PutCommand: vi.fn().mockImplementation((input) => ({ input })),
  UpdateCommand: vi.fn().mockImplementation((input) => ({ input })),
  QueryCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

const createEntry = (overrides: Partial<SourceStateEntry> = {}): SourceStateEntry => ({
  sourceCanonicalKey: 'the-swan-stone',
  entityType: 'venue',
  bndyId: 'bndy-venue-123',
  method: 'state',
  confidence: 1.0,
  sourceExternalIds: ['klma-venue-abc'],
  firstSeenAt: '2026-06-14T09:00:00Z',
  lastSeenAt: '2026-06-14T09:00:00Z',
  ...overrides,
});

describe('DynamoSourceStateStore', () => {
  const tableName = 'bndy-source-state-dev';
  const sourceId = 'klma-stoke-gig-list';
  let store: DynamoSourceStateStore;

  beforeEach(() => {
    store = new DynamoSourceStateStore(tableName);
    mockSend.mockReset();
  });

  describe('get', () => {
    it('should query with correct PK and SK', async () => {
      const entry = createEntry();
      mockSend.mockResolvedValueOnce({ Item: entry });

      await store.get(sourceId, 'venue', 'the-swan-stone');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe(tableName);
      expect(command.input.Key).toEqual({
        PK: 'SOURCE#klma-stoke-gig-list',
        SK: 'ENTITY#venue#the-swan-stone',
      });
    });

    it('should return entry when found', async () => {
      const entry = createEntry();
      mockSend.mockResolvedValueOnce({ Item: entry });

      const result = await store.get(sourceId, 'venue', 'the-swan-stone');

      expect(result).toEqual(entry);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await store.get(sourceId, 'venue', 'unknown-venue');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should put item with correct PK and SK', async () => {
      const entry = createEntry();
      mockSend.mockResolvedValueOnce({});

      await store.set(sourceId, entry);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe(tableName);
      expect(command.input.Item.PK).toBe('SOURCE#klma-stoke-gig-list');
      expect(command.input.Item.SK).toBe('ENTITY#venue#the-swan-stone');
    });

    it('should include all entry fields', async () => {
      const entry = createEntry({
        googlePlaceId: 'ChIJ12345',
      });
      mockSend.mockResolvedValueOnce({});

      await store.set(sourceId, entry);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Item.sourceCanonicalKey).toBe('the-swan-stone');
      expect(command.input.Item.entityType).toBe('venue');
      expect(command.input.Item.bndyId).toBe('bndy-venue-123');
      expect(command.input.Item.method).toBe('state');
      expect(command.input.Item.confidence).toBe(1.0);
      expect(command.input.Item.sourceExternalIds).toEqual(['klma-venue-abc']);
      expect(command.input.Item.googlePlaceId).toBe('ChIJ12345');
    });
  });

  describe('addExternalId', () => {
    it('should append external ID to existing entry', async () => {
      mockSend.mockResolvedValueOnce({});

      await store.addExternalId(sourceId, 'venue', 'the-swan-stone', 'klma-venue-new');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe(tableName);
      expect(command.input.Key).toEqual({
        PK: 'SOURCE#klma-stoke-gig-list',
        SK: 'ENTITY#venue#the-swan-stone',
      });
      // Should use list_append to add the new ID
      expect(command.input.UpdateExpression).toContain('sourceExternalIds');
    });
  });

  describe('getAllForSource', () => {
    it('should query all entities for a source', async () => {
      const entries = [
        createEntry({ sourceCanonicalKey: 'venue-1', entityType: 'venue' }),
        createEntry({ sourceCanonicalKey: 'artist-1', entityType: 'artist' }),
      ];
      mockSend.mockResolvedValueOnce({ Items: entries });

      const result = await store.getAllForSource(sourceId);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe(tableName);
      expect(command.input.KeyConditionExpression).toContain('PK = :pk');
      expect(command.input.ExpressionAttributeValues[':pk']).toBe(
        'SOURCE#klma-stoke-gig-list'
      );
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no entries', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await store.getAllForSource(sourceId);

      expect(result).toEqual([]);
    });

    it('should handle pagination', async () => {
      // First page
      mockSend.mockResolvedValueOnce({
        Items: [createEntry({ sourceCanonicalKey: 'venue-1' })],
        LastEvaluatedKey: { PK: 'SOURCE#klma-stoke-gig-list', SK: 'ENTITY#venue#venue-1' },
      });
      // Second page
      mockSend.mockResolvedValueOnce({
        Items: [createEntry({ sourceCanonicalKey: 'venue-2' })],
      });

      const result = await store.getAllForSource(sourceId);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });
  });

  describe('key format', () => {
    it('should use correct PK format: SOURCE#{sourceId}', async () => {
      mockSend.mockResolvedValueOnce({ Item: createEntry() });

      await store.get('custom-source', 'venue', 'key');

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Key.PK).toBe('SOURCE#custom-source');
    });

    it('should use correct SK format: ENTITY#{type}#{key}', async () => {
      mockSend.mockResolvedValueOnce({ Item: createEntry() });

      await store.get(sourceId, 'artist', 'the-explosions-band');

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Key.SK).toBe('ENTITY#artist#the-explosions-band');
    });
  });
});
