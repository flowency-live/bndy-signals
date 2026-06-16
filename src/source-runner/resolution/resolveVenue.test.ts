/**
 * Venue Resolver Tests
 *
 * Tests for the venue resolution ladder.
 * Priority: state → external-id → place_id → name+town → token → decide
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveVenue, VenueResolutionResult } from './resolveVenue';
import { InMemorySourceStateStore } from './SourceStateStore';
import { MockBndyWriteClient } from '../bndy-client/BndyWriteClient';
import { NormalisedVenueRef } from '../types';

const createVenueRef = (overrides: Partial<NormalisedVenueRef> = {}): NormalisedVenueRef => ({
  sourceVenueExternalId: 'klma-venue-abc123',
  sourceName: 'The Swan',
  canonicalName: 'The Swan, Stone',
  city: 'Stone',
  region: 'Staffordshire',
  nameVariants: [],
  ...overrides,
});

describe('resolveVenue', () => {
  let stateStore: InMemorySourceStateStore;
  let client: MockBndyWriteClient;
  const sourceId = 'klma-stoke-gig-list';

  beforeEach(() => {
    stateStore = new InMemorySourceStateStore();
    client = new MockBndyWriteClient();
  });

  describe('state store hit (step 1)', () => {
    it('should return bndyId from state store', async () => {
      // Pre-populate state store
      await stateStore.set(sourceId, {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-123',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-venue-abc123'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      const venueRef = createVenueRef();
      const result = await resolveVenue(venueRef, sourceId, { stateStore, client });

      expect(result.action).toBe('MATCH_EXISTING');
      expect(result.bndyId).toBe('bndy-venue-123');
      expect(result.method).toBe('state');
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('external-id hit (step 2)', () => {
    it('should return bndyId from external-id lookup', async () => {
      // Seed the mock client with known external-id mapping
      client.seedExternalIdMapping('klma-venue-abc123', 'venue', 'bndy-venue-456');

      const venueRef = createVenueRef();
      const result = await resolveVenue(venueRef, sourceId, { stateStore, client });

      expect(result.action).toBe('MATCH_EXISTING');
      expect(result.bndyId).toBe('bndy-venue-456');
      expect(result.method).toBe('external_id');
    });

    it('should update state store on external-id hit', async () => {
      client.seedExternalIdMapping('klma-venue-abc123', 'venue', 'bndy-venue-456');

      const venueRef = createVenueRef();
      await resolveVenue(venueRef, sourceId, { stateStore, client });

      // Verify state store was updated
      const stateEntry = await stateStore.get(sourceId, 'venue', 'the-swan-stone');
      expect(stateEntry).not.toBeNull();
      expect(stateEntry?.bndyId).toBe('bndy-venue-456');
      expect(stateEntry?.method).toBe('external_id');
    });
  });

  describe('no hit - always delegate to server (ADR-015/018)', () => {
    it('should return CREATE_NEW to delegate matching to server', async () => {
      // Per ADR-021 corrected semantics: always delegate fast-path miss to server.
      // Server does place_id geocode matching; canCreate controls create-vs-review.
      const venueRef = createVenueRef({
        sourceVenueExternalId: 'klma-venue-unknown',
        canonicalName: 'Some Random Venue',
        city: '', // Unknown town - server geocoder will handle
      });

      const result = await resolveVenue(venueRef, sourceId, { stateStore, client });

      expect(result.action).toBe('CREATE_NEW');
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('delegation semantics (canCreate is server-side)', () => {
    it('should return CREATE_NEW regardless of canCreate value', async () => {
      // canCreate controls server behavior, not client delegation.
      // Client always delegates; server matches-or-reviews when canCreate=false.
      const venueRef = createVenueRef({
        sourceVenueExternalId: 'klma-venue-new',
        canonicalName: 'The New Venue, Stone',
        city: 'Stone',
      });

      // Even with canCreate=false, client returns CREATE_NEW to delegate
      const result = await resolveVenue(venueRef, sourceId, {
        stateStore,
        client,
        canCreate: false,
      });

      expect(result.action).toBe('CREATE_NEW');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should return CREATE_NEW when canCreate=true and no match', async () => {
      const venueRef = createVenueRef({
        sourceVenueExternalId: 'klma-venue-new',
        canonicalName: 'The New Venue, Stone',
        city: 'Stone',
      });

      const result = await resolveVenue(venueRef, sourceId, {
        stateStore,
        client,
        canCreate: true,
      });

      expect(result.action).toBe('CREATE_NEW');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should return CREATE_NEW for unknown town (server geocodes)', async () => {
      // Per ADR-015: delegates to server's find-or-create.
      // Server handles unknown towns via geocoder - no client-side guard.
      const venueRef = createVenueRef({
        sourceVenueExternalId: 'klma-venue-unknown',
        canonicalName: 'Some Random Venue',
        city: '', // Unknown town - server geocoder will resolve
      });

      const result = await resolveVenue(venueRef, sourceId, {
        stateStore,
        client,
        canCreate: true,
      });

      expect(result.action).toBe('CREATE_NEW');
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('canonicalisation', () => {
    it('should use slug-normalised key for state lookup', async () => {
      // Store with normalised key
      await stateStore.set(sourceId, {
        sourceCanonicalKey: 'the-nags-head-macclesfield',
        entityType: 'venue',
        bndyId: 'bndy-venue-nags',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: [],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      // Lookup with different formatting (apostrophe should collapse)
      const venueRef = createVenueRef({
        sourceVenueExternalId: 'klma-venue-nags',
        sourceName: "The Nag's Head, Macclesfield",
        canonicalName: "The Nag's Head, Macclesfield",
        city: 'Macclesfield',
      });

      const result = await resolveVenue(venueRef, sourceId, { stateStore, client });

      expect(result.action).toBe('MATCH_EXISTING');
      expect(result.bndyId).toBe('bndy-venue-nags');
    });
  });

  describe('learning write-back', () => {
    it('should add external-id to state on match', async () => {
      // Existing state entry without this external-id
      await stateStore.set(sourceId, {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-123',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-venue-old'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      const venueRef = createVenueRef({
        sourceVenueExternalId: 'klma-venue-new-id',
      });

      await resolveVenue(venueRef, sourceId, { stateStore, client });

      const stateEntry = await stateStore.get(sourceId, 'venue', 'the-swan-stone');
      expect(stateEntry?.sourceExternalIds).toContain('klma-venue-old');
      expect(stateEntry?.sourceExternalIds).toContain('klma-venue-new-id');
    });
  });

  describe('result structure', () => {
    it('should include all required fields', async () => {
      const venueRef = createVenueRef();

      const result = await resolveVenue(venueRef, sourceId, { stateStore, client });

      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasons');
      expect(Array.isArray(result.reasons)).toBe(true);
    });
  });
});
