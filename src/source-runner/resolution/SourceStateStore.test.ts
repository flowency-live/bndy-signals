/**
 * SourceStateStore Tests
 *
 * Tests for the per-source state cache that provides idempotency.
 * Keyed on the runner's own canonical key (slugNormalise).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SourceStateStore,
  SourceStateEntry,
  InMemorySourceStateStore,
} from './SourceStateStore';

describe('SourceStateStore', () => {
  let store: InMemorySourceStateStore;

  beforeEach(() => {
    store = new InMemorySourceStateStore();
  });

  describe('interface compliance', () => {
    it('should implement SourceStateStore interface', () => {
      const _: SourceStateStore = store;
      expect(store).toBeDefined();
    });
  });

  describe('get', () => {
    it('should return null for unknown key', async () => {
      const result = await store.get('klma-stoke', 'venue', 'unknown-key');
      expect(result).toBeNull();
    });

    it('should return entry for known key', async () => {
      const entry: SourceStateEntry = {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-123',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-venue-abc'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      };

      await store.set('klma-stoke', entry);
      const result = await store.get('klma-stoke', 'venue', 'the-swan-stone');

      expect(result).toEqual(entry);
    });
  });

  describe('set', () => {
    it('should store entry and allow retrieval', async () => {
      const entry: SourceStateEntry = {
        sourceCanonicalKey: 'test-artist',
        entityType: 'artist',
        bndyId: 'bndy-artist-456',
        method: 'external_id',
        confidence: 0.95,
        sourceExternalIds: ['klma-artist-xyz'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      };

      await store.set('klma-stoke', entry);
      const result = await store.get('klma-stoke', 'artist', 'test-artist');

      expect(result).toEqual(entry);
    });

    it('should update existing entry', async () => {
      const entry1: SourceStateEntry = {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-123',
        method: 'state',
        confidence: 0.9,
        sourceExternalIds: ['klma-venue-abc'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      };
      const entry2: SourceStateEntry = {
        ...entry1,
        confidence: 1.0,
        lastSeenAt: '2026-06-15T09:00:00Z',
      };

      await store.set('klma-stoke', entry1);
      await store.set('klma-stoke', entry2);
      const result = await store.get('klma-stoke', 'venue', 'the-swan-stone');

      expect(result?.confidence).toBe(1.0);
      expect(result?.lastSeenAt).toBe('2026-06-15T09:00:00Z');
    });
  });

  describe('addExternalId', () => {
    it('should add external ID to existing entry', async () => {
      const entry: SourceStateEntry = {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-123',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-venue-abc'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      };

      await store.set('klma-stoke', entry);
      await store.addExternalId('klma-stoke', 'venue', 'the-swan-stone', 'klma-venue-xyz');

      const result = await store.get('klma-stoke', 'venue', 'the-swan-stone');
      expect(result?.sourceExternalIds).toContain('klma-venue-abc');
      expect(result?.sourceExternalIds).toContain('klma-venue-xyz');
    });

    it('should not add duplicate external ID', async () => {
      const entry: SourceStateEntry = {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-123',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-venue-abc'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      };

      await store.set('klma-stoke', entry);
      await store.addExternalId('klma-stoke', 'venue', 'the-swan-stone', 'klma-venue-abc');

      const result = await store.get('klma-stoke', 'venue', 'the-swan-stone');
      expect(result?.sourceExternalIds).toHaveLength(1);
    });
  });

  describe('source isolation', () => {
    it('should isolate entries by source', async () => {
      const entry1: SourceStateEntry = {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-klma',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: [],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      };
      const entry2: SourceStateEntry = {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-other',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: [],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      };

      await store.set('klma-stoke', entry1);
      await store.set('other-source', entry2);

      const klmaResult = await store.get('klma-stoke', 'venue', 'the-swan-stone');
      const otherResult = await store.get('other-source', 'venue', 'the-swan-stone');

      expect(klmaResult?.bndyId).toBe('bndy-venue-klma');
      expect(otherResult?.bndyId).toBe('bndy-venue-other');
    });
  });

  describe('googlePlaceId', () => {
    it('should store and retrieve googlePlaceId for venues', async () => {
      const entry: SourceStateEntry = {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-123',
        method: 'place_id',
        confidence: 1.0,
        sourceExternalIds: [],
        googlePlaceId: 'ChIJ123abc',
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      };

      await store.set('klma-stoke', entry);
      const result = await store.get('klma-stoke', 'venue', 'the-swan-stone');

      expect(result?.googlePlaceId).toBe('ChIJ123abc');
    });
  });

  describe('getAllForSource', () => {
    it('should return all entries for a source', async () => {
      await store.set('klma-stoke', {
        sourceCanonicalKey: 'venue-1',
        entityType: 'venue',
        bndyId: 'v1',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: [],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });
      await store.set('klma-stoke', {
        sourceCanonicalKey: 'artist-1',
        entityType: 'artist',
        bndyId: 'a1',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: [],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      const all = await store.getAllForSource('klma-stoke');

      expect(all).toHaveLength(2);
    });
  });
});
