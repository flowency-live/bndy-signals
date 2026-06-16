/**
 * Artist Resolver Tests
 *
 * Tests for the artist resolution ladder.
 * Priority: state → external-id → normalise → strip suffixes → search → token check → decide
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveArtist, ArtistResolutionResult } from './resolveArtist';
import { InMemorySourceStateStore } from './SourceStateStore';
import { MockBndyWriteClient } from '../bndy-client/BndyWriteClient';
import { NormalisedArtistRef } from '../types';

const createArtistRef = (overrides: Partial<NormalisedArtistRef> = {}): NormalisedArtistRef => ({
  sourceArtistExternalId: 'klma-artist-abc123',
  sourceName: 'Test Artist',
  canonicalName: 'Test Artist',
  region: 'Staffordshire UK',
  ...overrides,
});

describe('resolveArtist', () => {
  let stateStore: InMemorySourceStateStore;
  let client: MockBndyWriteClient;
  const sourceId = 'klma-stoke-gig-list';

  beforeEach(() => {
    stateStore = new InMemorySourceStateStore();
    client = new MockBndyWriteClient();
  });

  describe('state store hit (step 1)', () => {
    it('should return bndyId from state store', async () => {
      await stateStore.set(sourceId, {
        sourceCanonicalKey: 'test-artist',
        entityType: 'artist',
        bndyId: 'bndy-artist-123',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-artist-abc123'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      const artistRef = createArtistRef();
      const result = await resolveArtist(artistRef, sourceId, { stateStore, client });

      expect(result.action).toBe('MATCH_EXISTING');
      expect(result.bndyId).toBe('bndy-artist-123');
      expect(result.method).toBe('state');
    });
  });

  describe('external-id hit (step 2)', () => {
    it('should return bndyId from external-id lookup', async () => {
      client.seedExternalIdMapping('klma-artist-abc123', 'artist', 'bndy-artist-456');

      const artistRef = createArtistRef();
      const result = await resolveArtist(artistRef, sourceId, { stateStore, client });

      expect(result.action).toBe('MATCH_EXISTING');
      expect(result.bndyId).toBe('bndy-artist-456');
      expect(result.method).toBe('external_id');
    });

    it('should update state store on external-id hit', async () => {
      client.seedExternalIdMapping('klma-artist-abc123', 'artist', 'bndy-artist-456');

      const artistRef = createArtistRef();
      await resolveArtist(artistRef, sourceId, { stateStore, client });

      const stateEntry = await stateStore.get(sourceId, 'artist', 'test-artist');
      expect(stateEntry).not.toBeNull();
      expect(stateEntry?.bndyId).toBe('bndy-artist-456');
    });
  });

  describe('name normalisation (step 3)', () => {
    it('should normalise names with spaces/punctuation', async () => {
      // Store with normalised key
      await stateStore.set(sourceId, {
        sourceCanonicalKey: 'circa-81',
        entityType: 'artist',
        bndyId: 'bndy-artist-circa',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: [],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      // Lookup with different spacing (Circa 81 vs Circa81)
      const artistRef = createArtistRef({
        sourceArtistExternalId: 'klma-artist-circa',
        sourceName: 'Circa 81',
        canonicalName: 'Circa 81',
      });

      const result = await resolveArtist(artistRef, sourceId, { stateStore, client });

      expect(result.action).toBe('MATCH_EXISTING');
      expect(result.bndyId).toBe('bndy-artist-circa');
    });
  });

  describe('suffix stripping (step 4)', () => {
    it('should try stripped core token for Band suffix', async () => {
      // Store with core token key
      await stateStore.set(sourceId, {
        sourceCanonicalKey: 'the-explosions',
        entityType: 'artist',
        bndyId: 'bndy-artist-explosions',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: [],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      // Lookup with "Band" suffix
      const artistRef = createArtistRef({
        sourceArtistExternalId: 'klma-artist-explosions',
        sourceName: 'The Explosions Band',
        canonicalName: 'The Explosions Band',
      });

      const result = await resolveArtist(artistRef, sourceId, { stateStore, client });

      expect(result.action).toBe('MATCH_EXISTING');
      expect(result.bndyId).toBe('bndy-artist-explosions');
    });

    it('should try stripped core token for Duo suffix', async () => {
      await stateStore.set(sourceId, {
        sourceCanonicalKey: 'acoustic-vibes',
        entityType: 'artist',
        bndyId: 'bndy-artist-vibes',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: [],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      const artistRef = createArtistRef({
        sourceArtistExternalId: 'klma-artist-vibes',
        sourceName: 'Acoustic Vibes Duo',
        canonicalName: 'Acoustic Vibes Duo',
      });

      const result = await resolveArtist(artistRef, sourceId, { stateStore, client });

      expect(result.action).toBe('MATCH_EXISTING');
      expect(result.bndyId).toBe('bndy-artist-vibes');
    });
  });

  describe('delegation semantics (canCreate is server-side)', () => {
    it('should return CREATE_NEW to delegate matching to server (ADR-015/021)', async () => {
      // Per ADR-021 corrected semantics: always delegate fast-path miss to server.
      // Server does footprint scoring to match; canCreate controls create-vs-review.
      const artistRef = createArtistRef({
        sourceArtistExternalId: 'klma-artist-new',
        sourceName: 'Brand New Artist',
        canonicalName: 'Brand New Artist',
      });

      // Even with canCreate=false (or undefined), client returns CREATE_NEW to delegate
      const result = await resolveArtist(artistRef, sourceId, { stateStore, client });

      expect(result.action).toBe('CREATE_NEW');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should return CREATE_NEW when canCreate=true and no match', async () => {
      const artistRef = createArtistRef({
        sourceArtistExternalId: 'klma-artist-new',
        sourceName: 'Brand New Artist',
        canonicalName: 'Brand New Artist',
      });

      const result = await resolveArtist(artistRef, sourceId, {
        stateStore,
        client,
        canCreate: true,
      });

      expect(result.action).toBe('CREATE_NEW');
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('learning write-back', () => {
    it('should add external-id to state on match', async () => {
      await stateStore.set(sourceId, {
        sourceCanonicalKey: 'test-artist',
        entityType: 'artist',
        bndyId: 'bndy-artist-123',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-artist-old'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      const artistRef = createArtistRef({
        sourceArtistExternalId: 'klma-artist-new-id',
      });

      await resolveArtist(artistRef, sourceId, { stateStore, client });

      const stateEntry = await stateStore.get(sourceId, 'artist', 'test-artist');
      expect(stateEntry?.sourceExternalIds).toContain('klma-artist-old');
      expect(stateEntry?.sourceExternalIds).toContain('klma-artist-new-id');
    });
  });

  describe('result structure', () => {
    it('should include all required fields', async () => {
      const artistRef = createArtistRef();

      const result = await resolveArtist(artistRef, sourceId, { stateStore, client });

      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasons');
      expect(Array.isArray(result.reasons)).toBe(true);
    });
  });
});
