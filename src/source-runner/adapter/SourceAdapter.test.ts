/**
 * SourceAdapter Tests
 *
 * Tests for the SourceAdapter interface and registry.
 * ADR-014: Formalise a SourceAdapter interface so new sources drop in cleanly.
 */

import { describe, it, expect } from 'vitest';
import { SourceAdapter, getSourceAdapter, registerSourceAdapter } from './SourceAdapter';
import { SourceConfig, SourceRun, NormalisedEvent, ParkingLotItem } from '../types';
import { FetchedSource, ParsedSource } from '../runner';

// Test fixtures
const testConfig: SourceConfig = {
  id: 'test-source',
  name: 'Test Source',
  type: 'community_sheet',
  region: 'Test Region',
  defaultCity: 'Test City',
  defaultArtistLocation: 'Test Region UK',
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
  sourceId: 'test-source',
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

describe('SourceAdapter', () => {
  describe('interface contract', () => {
    it('should define fetch, parse, and normalise methods', () => {
      // Type check - if this compiles, the interface is correct
      const mockAdapter: SourceAdapter = {
        fetch: async (_config: SourceConfig, _run: SourceRun): Promise<FetchedSource> => ({
          kind: 'csv',
          body: 'test',
        }),
        parse: async (
          _config: SourceConfig,
          _run: SourceRun,
          _raw: FetchedSource
        ): Promise<ParsedSource> => ({
          events: [],
          parked: [],
        }),
      };

      expect(mockAdapter.fetch).toBeInstanceOf(Function);
      expect(mockAdapter.parse).toBeInstanceOf(Function);
    });
  });

  describe('registry', () => {
    it('should register and retrieve adapters by sourceId', () => {
      const mockAdapter: SourceAdapter = {
        fetch: async () => ({ kind: 'csv', body: '' }),
        parse: async () => ({ events: [], parked: [] }),
      };

      registerSourceAdapter('registry-test-source', mockAdapter);

      const retrieved = getSourceAdapter('registry-test-source');
      expect(retrieved).toBe(mockAdapter);
    });

    it('should return undefined for unregistered sourceId', () => {
      const result = getSourceAdapter('nonexistent-source');
      expect(result).toBeUndefined();
    });

    it('should allow overwriting existing adapter', () => {
      const adapter1: SourceAdapter = {
        fetch: async () => ({ kind: 'csv', body: 'v1' }),
        parse: async () => ({ events: [], parked: [] }),
      };
      const adapter2: SourceAdapter = {
        fetch: async () => ({ kind: 'csv', body: 'v2' }),
        parse: async () => ({ events: [], parked: [] }),
      };

      registerSourceAdapter('overwrite-test', adapter1);
      registerSourceAdapter('overwrite-test', adapter2);

      const retrieved = getSourceAdapter('overwrite-test');
      expect(retrieved).toBe(adapter2);
    });
  });

  describe('adapter usage', () => {
    it('should execute fetch and parse pipeline', async () => {
      const mockEvents: NormalisedEvent[] = [
        {
          sourceId: 'test-source',
          externalId: 'event-1',
          date: '2026-06-20',
          startTime: '21:00',
          timeProvenance: 'parsed',
          venue: {
            sourceVenueExternalId: 'venue-1',
            sourceName: 'Test Venue',
            canonicalName: 'Test Venue',
            city: 'Test City',
            region: 'Test Region',
            nameVariants: [],
          },
          artist: {
            sourceArtistExternalId: 'artist-1',
            sourceName: 'Test Artist',
            canonicalName: 'Test Artist',
            region: 'Test Region UK',
          },
          rawRowRef: 'row:1',
          confidence: 0.9,
          parseWarnings: [],
        },
      ];

      const mockParked: ParkingLotItem[] = [
        {
          reason: 'specialist_venue',
          sourceId: 'test-source',
          rawData: { artist: 'Test', venue: 'Specialist Venue' },
          capturedAt: '2026-06-14T09:00:00Z',
        },
      ];

      const adapter: SourceAdapter = {
        fetch: async () => ({
          kind: 'csv',
          body: 'date,artist,venue,time\n2026-06-20,Test Artist,Test Venue,21:00',
        }),
        parse: async () => ({
          events: mockEvents,
          parked: mockParked,
        }),
      };

      // Execute pipeline
      const raw = await adapter.fetch(testConfig, testRun);
      const parsed = await adapter.parse(testConfig, testRun, raw);

      expect(raw.kind).toBe('csv');
      expect(parsed.events).toHaveLength(1);
      expect(parsed.parked).toHaveLength(1);
      expect(parsed.events[0].externalId).toBe('event-1');
    });
  });
});
