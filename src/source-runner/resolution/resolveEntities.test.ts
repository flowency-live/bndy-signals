/**
 * resolveEntities Tests
 *
 * Tests for the entity resolution orchestrator.
 * Includes the never-delete-past guard (finding G).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveEntities, ResolveEntitiesResult } from './resolveEntities';
import { InMemorySourceStateStore } from './SourceStateStore';
import { MockBndyWriteClient } from '../bndy-client/BndyWriteClient';
import { SourceConfig, EventDiffReport, NormalisedEvent, SnapshotSemantics } from '../types';

const createEvent = (overrides: Partial<NormalisedEvent> = {}): NormalisedEvent => ({
  sourceId: 'klma-stoke-gig-list',
  externalId: 'klma-abc123',
  date: '2026-06-20',
  startTime: '21:00',
  timeProvenance: 'parsed',
  venue: {
    sourceVenueExternalId: 'klma-venue-123',
    sourceName: 'The Swan',
    canonicalName: 'The Swan, Stone',
    city: 'Stone',
    region: 'Staffordshire',
    nameVariants: [],
  },
  artist: {
    sourceArtistExternalId: 'klma-artist-456',
    sourceName: 'Test Artist',
    canonicalName: 'Test Artist',
    region: 'Staffordshire UK',
  },
  rawRowRef: 'row:1',
  confidence: 0.9,
  parseWarnings: [],
  ...overrides,
});

const createConfig = (overrides: Partial<SourceConfig> = {}): SourceConfig => ({
  id: 'klma-stoke-gig-list',
  name: 'KLMA Stoke Gig List',
  type: 'community_sheet',
  region: 'Staffordshire',
  defaultCity: 'Stoke-on-Trent',
  defaultArtistLocation: 'Staffordshire UK',
  timezone: 'Europe/London',
  schedule: { cadence: 'daily', localTime: '09:00' },
  input: { kind: 'google_sheet_csv', sheetId: 'test', gid: '0' },
  eventPolicy: {
    createPublicEvents: true,
    missingTimeDefault: '21:00',
    deleteFutureMissingRows: true,
    neverDeletePastEvents: true,
    duplicateEventBehaviour: 'attach_external_id_no_clobber',
  },
  parkingLot: { reasons: [] },
  thresholds: {
    venueAutoMatch: 0.95,
    artistAutoMatch: 0.9,
    eventAutoCreate: 0.95,
    socialAutoAttach: 0.95,
  },
  snapshotSemantics: 'complete',
  ...overrides,
});

describe('resolveEntities', () => {
  let stateStore: InMemorySourceStateStore;
  let client: MockBndyWriteClient;

  beforeEach(() => {
    stateStore = new InMemorySourceStateStore();
    client = new MockBndyWriteClient();
  });

  describe('added events', () => {
    it('should delegate unknown venue/artist to server via create action (ADR-015/021)', async () => {
      // Per ADR-021 corrected semantics: client always delegates fast-path miss to server.
      // Server does place_id/footprint matching; canCreate controls create-vs-review on server.
      // Client returns action='create' so applyWrites calls find-or-create APIs.
      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [createEvent({ externalId: 'new-event-1' })],
        cancelledCandidates: [],
        unchanged: [],
        pastDropped: [],
        absencesForReview: [],
      };
      const config = createConfig();

      const result = await resolveEntities(config, diff, { stateStore, client });

      expect(result.resolved).toHaveLength(1);
      // Unknown entities delegate to server via find-or-create (action='create')
      expect(result.resolved[0].action).toBe('create');
      // venueId/artistId undefined signals applyWrites to call find-or-create
      expect(result.resolved[0].venueId).toBeUndefined();
      expect(result.resolved[0].artistId).toBeUndefined();
    });

    it('should resolve known venue and artist to create', async () => {
      // Seed state store with known entities
      await stateStore.set('klma-stoke-gig-list', {
        sourceCanonicalKey: 'the-swan-stone',
        entityType: 'venue',
        bndyId: 'bndy-venue-123',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-venue-123'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });
      await stateStore.set('klma-stoke-gig-list', {
        sourceCanonicalKey: 'test-artist',
        entityType: 'artist',
        bndyId: 'bndy-artist-456',
        method: 'state',
        confidence: 1.0,
        sourceExternalIds: ['klma-artist-456'],
        firstSeenAt: '2026-06-14T09:00:00Z',
        lastSeenAt: '2026-06-14T09:00:00Z',
      });

      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [createEvent({ externalId: 'new-event-1' })],
        cancelledCandidates: [],
        unchanged: [],
        pastDropped: [],
        absencesForReview: [],
      };
      const config = createConfig();

      const result = await resolveEntities(config, diff, { stateStore, client });

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].action).toBe('create');
      expect(result.resolved[0].venueId).toBe('bndy-venue-123');
      expect(result.resolved[0].artistId).toBe('bndy-artist-456');
    });
  });

  describe('never-delete-past guard (finding G)', () => {
    it('should add cancelledCandidates (future) to eventsToDelete', async () => {
      const futureEvent = createEvent({
        externalId: 'future-cancelled',
        date: '2026-06-20', // After run date
      });
      // Seed the client so the event can be resolved to a bndy ID
      client.seedExternalIdMapping('future-cancelled', 'event', 'bndy-event-future');

      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [],
        cancelledCandidates: [futureEvent],
        unchanged: [],
        pastDropped: [],
        absencesForReview: [],
      };
      const config = createConfig();

      const result = await resolveEntities(config, diff, { stateStore, client });

      expect(result.eventsToDelete).toContain('bndy-event-future');
    });

    it('should NEVER add pastDropped events to eventsToDelete', async () => {
      const pastEvent = createEvent({
        externalId: 'past-dropped',
        date: '2026-06-10', // Before run date
      });
      client.seedExternalIdMapping('past-dropped', 'event', 'bndy-event-past');

      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [],
        cancelledCandidates: [],
        unchanged: [],
        pastDropped: [pastEvent],
        absencesForReview: [],
      };
      const config = createConfig();

      const result = await resolveEntities(config, diff, { stateStore, client });

      expect(result.eventsToDelete).not.toContain('bndy-event-past');
      expect(result.eventsToDelete).toHaveLength(0);
    });

    it('should never infer cancellations for one_shot sources', async () => {
      const futureEvent = createEvent({
        externalId: 'future-event',
        date: '2026-06-20',
      });
      client.seedExternalIdMapping('future-event', 'event', 'bndy-event-future');

      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [],
        cancelledCandidates: [futureEvent], // Would be cancelled if complete
        unchanged: [],
        pastDropped: [],
        absencesForReview: [],
      };
      const config = createConfig({ snapshotSemantics: 'one_shot' });

      const result = await resolveEntities(config, diff, { stateStore, client });

      // one_shot sources should never produce deletes
      expect(result.eventsToDelete).toHaveLength(0);
    });

    it('should route absences to review for incremental sources', async () => {
      const futureEvent = createEvent({
        externalId: 'future-event',
        date: '2026-06-20',
      });

      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [],
        cancelledCandidates: [], // Incremental doesn't use cancelledCandidates
        unchanged: [],
        pastDropped: [],
        absencesForReview: [futureEvent], // Routed here instead
      };
      const config = createConfig({ snapshotSemantics: 'incremental' });

      const result = await resolveEntities(config, diff, { stateStore, client });

      expect(result.eventsToDelete).toHaveLength(0);
      // Incremental absences should create review items, not deletes
    });
  });

  describe('snapshotSemantics guard', () => {
    it('should only delete when snapshotSemantics is complete', async () => {
      const futureEvent = createEvent({
        externalId: 'future-event',
        date: '2026-06-20',
      });
      client.seedExternalIdMapping('future-event', 'event', 'bndy-event-future');

      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [],
        cancelledCandidates: [futureEvent],
        unchanged: [],
        pastDropped: [],
        absencesForReview: [],
      };
      const config = createConfig({ snapshotSemantics: 'complete' });

      const result = await resolveEntities(config, diff, { stateStore, client });

      expect(result.eventsToDelete).toHaveLength(1);
    });
  });

  describe('result structure', () => {
    it('should return resolved events and review items', async () => {
      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [createEvent()],
        cancelledCandidates: [],
        unchanged: [],
        pastDropped: [],
        absencesForReview: [],
      };
      const config = createConfig();

      const result = await resolveEntities(config, diff, { stateStore, client });

      expect(result).toHaveProperty('resolved');
      expect(result).toHaveProperty('reviewItems');
      expect(result).toHaveProperty('eventsToDelete');
      expect(Array.isArray(result.resolved)).toBe(true);
      expect(Array.isArray(result.reviewItems)).toBe(true);
      expect(Array.isArray(result.eventsToDelete)).toBe(true);
    });
  });
});
