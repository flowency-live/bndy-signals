/**
 * applyWrites Tests
 *
 * Tests for applying resolved entities to bndy via the write client.
 * Covers safety caps, isPublic guard, and delete→hide fallback.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyWrites } from './applyWrites';
import { MockBndyWriteClient } from './BndyWriteClient';
import { ResolvedEntities, ApplyWritesOptions } from '../runner';
import {
  SourceConfig,
  SourceRun,
  NormalisedEvent,
  SafetyCaps,
  DEFAULT_SAFETY_CAPS,
} from '../types';

// Test fixtures
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

const testConfig: SourceConfig = {
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
};

const testRun: SourceRun = {
  runId: 'test-run-1',
  sourceId: 'klma-stoke-gig-list',
  runDate: '2026-06-14',
  startedAt: '2026-06-14T09:00:00Z',
  status: 'in_progress',
  counts: {
    rawRows: 0,
    validEvents: 0,
    metadataRows: 0,
    parkedRows: 0,
    added: 0,
    cancelled: 0,
    unchanged: 0,
    pastDropped: 0,
    eventsCreated: 0,
    eventsRepointed: 0,
    eventsDeleted: 0,
    eventsHidden: 0,
    venuesCreated: 0,
    venuesMatched: 0,
    artistsCreated: 0,
    artistsMatched: 0,
    reviewItems: 0,
  },
  errors: [],
};

const defaultOptions: ApplyWritesOptions = {
  dryRun: false,
  reviewOnly: false,
  safetyCaps: DEFAULT_SAFETY_CAPS,
};

describe('applyWrites', () => {
  let client: MockBndyWriteClient;

  beforeEach(() => {
    client = new MockBndyWriteClient();
  });

  describe('event creation', () => {
    it('should create events for resolved entities with action=create', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent({ externalId: 'e1' }),
            venueId: 'venue-123',
            artistId: 'artist-456',
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.counts.eventsCreated).toBe(1);
      expect(client.getCounts().eventsCreated).toBe(1);
    });

    it('should skip events with action=skip', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent({ externalId: 'e1' }),
            venueId: 'venue-123',
            artistId: 'artist-456',
            action: 'skip',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.counts.eventsCreated).toBe(0);
      expect(client.getCounts().eventsCreated).toBe(0);
    });

    it('should not write events with action=review', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent({ externalId: 'e1' }),
            venueId: 'venue-123',
            artistId: 'artist-456',
            action: 'review',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.counts.eventsCreated).toBe(0);
    });
  });

  describe('isPublic guard', () => {
    it('should set isPublic=true when config.eventPolicy.createPublicEvents=true', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent(),
            venueId: 'v1',
            artistId: 'a1',
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      const ops = client.getRecordedOperations();
      const createOp = ops.find((op) => op.type === 'createEvent');
      expect(createOp?.type === 'createEvent' && createOp.request.isPublic).toBe(true);
    });

    it('should set isPublic=false when config.eventPolicy.createPublicEvents=false', async () => {
      const privateConfig: SourceConfig = {
        ...testConfig,
        eventPolicy: {
          ...testConfig.eventPolicy,
          createPublicEvents: false,
        },
      };
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent(),
            venueId: 'v1',
            artistId: 'a1',
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      await applyWrites(client, privateConfig, testRun, resolved, defaultOptions);

      const ops = client.getRecordedOperations();
      const createOp = ops.find((op) => op.type === 'createEvent');
      expect(createOp?.type === 'createEvent' && createOp.request.isPublic).toBe(false);
    });
  });

  describe('safety caps', () => {
    it('should stop creating events when maxCreatesPerRun is reached', async () => {
      const caps: SafetyCaps = {
        ...DEFAULT_SAFETY_CAPS,
        maxCreatesPerRun: 2,
      };
      const resolved: ResolvedEntities = {
        resolved: [
          { event: createEvent({ externalId: 'e1' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e2' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e3' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e4' }), venueId: 'v1', artistId: 'a1', action: 'create' },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, {
        ...defaultOptions,
        safetyCaps: caps,
      });

      expect(result.counts.eventsCreated).toBe(2);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((e) => e.code === 'SAFETY_CAP_REACHED')).toBe(true);
    });

    it('should stop deleting events when maxDeletesPerRun is reached', async () => {
      const caps: SafetyCaps = {
        ...DEFAULT_SAFETY_CAPS,
        maxDeletesPerRun: 1,
      };
      // Seed events to delete
      client.seedExternalIdMapping('del-1', 'event', 'event-del-1');
      client.seedExternalIdMapping('del-2', 'event', 'event-del-2');
      client.seedExternalIdMapping('del-3', 'event', 'event-del-3');

      const resolved: ResolvedEntities = {
        resolved: [],
        reviewItems: [],
        eventsToDelete: ['event-del-1', 'event-del-2', 'event-del-3'],
      } as ResolvedEntities & { eventsToDelete: string[] };

      const result = await applyWrites(client, testConfig, testRun, resolved, {
        ...defaultOptions,
        safetyCaps: caps,
      });

      expect(result.counts.eventsDeleted).toBe(1);
    });

    it('should honor maxWrites option when lower than safetyCaps', async () => {
      // safetyCaps allows 50, but maxWrites is 3 - should cap at 3
      const resolved: ResolvedEntities = {
        resolved: [
          { event: createEvent({ externalId: 'e1' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e2' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e3' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e4' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e5' }), venueId: 'v1', artistId: 'a1', action: 'create' },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, {
        ...defaultOptions,
        maxWrites: 3,
      });

      expect(result.counts.eventsCreated).toBe(3);
      expect(result.errors).toBeDefined();
      expect(result.errors?.some((e) => e.code === 'SAFETY_CAP_REACHED')).toBe(true);
    });

    it('should use safetyCaps when maxWrites is higher', async () => {
      const caps: SafetyCaps = {
        ...DEFAULT_SAFETY_CAPS,
        maxCreatesPerRun: 2,
      };
      const resolved: ResolvedEntities = {
        resolved: [
          { event: createEvent({ externalId: 'e1' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e2' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e3' }), venueId: 'v1', artistId: 'a1', action: 'create' },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, {
        ...defaultOptions,
        safetyCaps: caps,
        maxWrites: 100, // Higher than safetyCaps - should still cap at 2
      });

      expect(result.counts.eventsCreated).toBe(2);
    });
  });

  describe('delete→hide fallback', () => {
    it('should hide event when delete fails', async () => {
      client.setDeleteBehavior('fail');
      client.seedExternalIdMapping('del-1', 'event', 'event-del-1');

      const resolved: ResolvedEntities = {
        resolved: [],
        reviewItems: [],
        eventsToDelete: ['event-del-1'],
      } as ResolvedEntities & { eventsToDelete: string[] };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.counts.eventsDeleted).toBe(0);
      expect(result.counts.eventsHidden).toBe(1);
      expect(result.reviewItems?.some((r) => r.type === 'delete_failed_hidden')).toBe(true);
    });
  });

  describe('dry run', () => {
    it('should not write anything in dry run mode', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent(),
            venueId: 'v1',
            artistId: 'a1',
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, {
        ...defaultOptions,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(client.getRecordedOperations()).toHaveLength(0);
    });
  });

  describe('review only', () => {
    it('should not write anything in review only mode', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent(),
            venueId: 'v1',
            artistId: 'a1',
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, {
        ...defaultOptions,
        reviewOnly: true,
      });

      expect(result.success).toBe(true);
      expect(client.getRecordedOperations()).toHaveLength(0);
    });
  });

  describe('multiple operations', () => {
    it('should handle mixed create and repoint operations', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          { event: createEvent({ externalId: 'e1' }), venueId: 'v1', artistId: 'a1', action: 'create' },
          { event: createEvent({ externalId: 'e2' }), venueId: 'v2', artistId: 'a2', action: 'repoint' },
          { event: createEvent({ externalId: 'e3' }), venueId: 'v3', artistId: 'a3', action: 'skip' },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.counts.eventsCreated).toBe(1);
      expect(result.counts.eventsRepointed).toBe(1);
    });
  });

  describe('find-or-create delegation', () => {
    it('should call createVenue when venueId is undefined but action is create', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent({ externalId: 'e1' }),
            venueId: undefined, // Venue not yet resolved - needs find-or-create
            artistId: 'a1',
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.counts.eventsCreated).toBe(1);
      expect(result.counts.venuesCreated).toBe(1);

      // Verify venue was created first
      const ops = client.getRecordedOperations();
      const venueOp = ops.find((op) => op.type === 'createVenue');
      const eventOp = ops.find((op) => op.type === 'createEvent');

      expect(venueOp).toBeDefined();
      expect(eventOp).toBeDefined();

      // Ensure venue was created before event
      const venueIndex = ops.indexOf(venueOp!);
      const eventIndex = ops.indexOf(eventOp!);
      expect(venueIndex).toBeLessThan(eventIndex);
    });

    it('should call createArtist when artistId is undefined but action is create', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent({ externalId: 'e1' }),
            venueId: 'v1',
            artistId: undefined, // Artist not yet resolved - needs find-or-create
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.counts.eventsCreated).toBe(1);
      expect(result.counts.artistsCreated).toBe(1);

      // Verify artist was created
      const ops = client.getRecordedOperations();
      const artistOp = ops.find((op) => op.type === 'createArtist');
      expect(artistOp).toBeDefined();
    });

    it('should call both createVenue and createArtist when both are undefined', async () => {
      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent({ externalId: 'e1' }),
            venueId: undefined,
            artistId: undefined,
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.counts.eventsCreated).toBe(1);
      expect(result.counts.venuesCreated).toBe(1);
      expect(result.counts.artistsCreated).toBe(1);

      const ops = client.getRecordedOperations();
      expect(ops.filter((op) => op.type === 'createVenue')).toHaveLength(1);
      expect(ops.filter((op) => op.type === 'createArtist')).toHaveLength(1);
      expect(ops.filter((op) => op.type === 'createEvent')).toHaveLength(1);
    });

    it('should reuse existing venueId from earlier event in same batch', async () => {
      const event1 = createEvent({ externalId: 'e1' });
      const event2 = createEvent({ externalId: 'e2' });
      // Both events are at the same venue
      event2.venue = event1.venue;

      const resolved: ResolvedEntities = {
        resolved: [
          { event: event1, venueId: undefined, artistId: 'a1', action: 'create' },
          { event: event2, venueId: undefined, artistId: 'a2', action: 'create' },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.counts.eventsCreated).toBe(2);
      // Venue should only be created once since both events share the same venue
      expect(result.counts.venuesCreated).toBe(1);
    });

    it('should skip event and create review item when venue creation fails', async () => {
      client.setVenueCreateBehavior('fail');

      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent({ externalId: 'e1' }),
            venueId: undefined,
            artistId: 'a1',
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.counts.eventsCreated).toBe(0);
      expect(result.reviewItems?.some((r) => r.type === 'venue_create_failed')).toBe(true);
    });

    it('should skip event and create review item when artist creation fails', async () => {
      client.setArtistCreateBehavior('fail');

      const resolved: ResolvedEntities = {
        resolved: [
          {
            event: createEvent({ externalId: 'e1' }),
            venueId: 'v1',
            artistId: undefined,
            action: 'create',
          },
        ],
        reviewItems: [],
      };

      const result = await applyWrites(client, testConfig, testRun, resolved, defaultOptions);

      expect(result.counts.eventsCreated).toBe(0);
      expect(result.reviewItems?.some((r) => r.type === 'artist_create_failed')).toBe(true);
    });
  });
});
