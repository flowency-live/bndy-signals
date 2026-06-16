/**
 * KLMA Adapter Tests
 *
 * Tests for the KLMA source adapter implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { klmaStokeAdapter } from './adapter';
import { getSourceAdapter } from '../../adapter/SourceAdapter';
import { SourceConfig, SourceRun } from '../../types';
import { FetchedSource } from '../../runner';

// Mock fetch for testing
vi.mock('./fetch', () => ({
  fetchKlmaSource: vi.fn(),
}));

import { fetchKlmaSource } from './fetch';

const testConfig: SourceConfig = {
  id: 'klma-stoke-gig-list',
  name: 'KLMA Stoke Gig List',
  type: 'community_sheet',
  region: 'Staffordshire',
  defaultCity: 'Stoke-on-Trent',
  defaultArtistLocation: 'Staffordshire UK',
  timezone: 'Europe/London',
  schedule: { cadence: 'daily', localTime: '09:00' },
  input: {
    kind: 'google_sheet_csv',
    sheetId: 'test-sheet-id',
    gid: '0',
    preferredExport: 'export_csv',
    fallbackExport: 'gviz_csv',
  },
  eventPolicy: {
    createPublicEvents: true,
    missingTimeDefault: '21:00',
    deleteFutureMissingRows: true,
    neverDeletePastEvents: true,
    duplicateEventBehaviour: 'attach_external_id_no_clobber',
  },
  parkingLot: {
    specialistVenueSlugs: ['artisan-tap', 'eleven'],
    multiActVenueSlugs: ['the-rigger-newcastle-under-lyme'],
    reasons: [
      'specialist_venue',
      'multi_act',
      'non_artist_event',
      'form_metadata',
      'unparseable',
    ],
  },
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

describe('KLMA Adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('registration', () => {
    it('should be registered under klma-stoke-gig-list', () => {
      const adapter = getSourceAdapter('klma-stoke-gig-list');
      expect(adapter).toBe(klmaStokeAdapter);
    });
  });

  describe('fetch', () => {
    it('should delegate to fetchKlmaSource', async () => {
      const mockResult: FetchedSource = {
        kind: 'csv',
        body: 'test data',
        fetchMethod: 'export_csv',
      };
      vi.mocked(fetchKlmaSource).mockResolvedValue(mockResult);

      const result = await klmaStokeAdapter.fetch(testConfig, testRun);

      expect(fetchKlmaSource).toHaveBeenCalledWith(testConfig, testRun);
      expect(result).toBe(mockResult);
    });
  });

  describe('parse', () => {
    it('should parse valid CSV into events', async () => {
      // KLMA uses UK date format (DD/MM/YYYY)
      const raw: FetchedSource = {
        kind: 'csv',
        body: [
          '"Date","Artist","Venue","Time","Genre","URL"',
          '"20/06/2026","Test Artist","The Swan, Stone","9pm","Rock",""',
        ].join('\n'),
      };

      const result = await klmaStokeAdapter.parse(testConfig, testRun, raw);

      expect(result.events).toHaveLength(1);
      expect(result.events[0].artist.sourceName).toBe('Test Artist');
      expect(result.events[0].venue.canonicalName).toBe('The Swan, Stone');
      expect(result.events[0].startTime).toBe('21:00');
    });

    it('should park specialist venue rows', async () => {
      const raw: FetchedSource = {
        kind: 'csv',
        body: [
          '"Date","Artist","Venue","Time","Genre","URL"',
          '"20/06/2026","Test Artist","Artisan Tap Hartshill","9pm","Rock",""',
        ].join('\n'),
      };

      const result = await klmaStokeAdapter.parse(testConfig, testRun, raw);

      expect(result.events).toHaveLength(0);
      expect(result.parked).toHaveLength(1);
      expect(result.parked[0].reason).toBe('specialist_venue');
    });

    it('should park multi-act venue rows', async () => {
      const raw: FetchedSource = {
        kind: 'csv',
        body: [
          '"Date","Artist","Venue","Time","Genre","URL"',
          '"20/06/2026","Test Artist","The Rigger, Newcastle-under-Lyme","9pm","Rock",""',
        ].join('\n'),
      };

      const result = await klmaStokeAdapter.parse(testConfig, testRun, raw);

      expect(result.events).toHaveLength(0);
      expect(result.parked).toHaveLength(1);
      expect(result.parked[0].reason).toBe('multi_act');
    });

    it('should park rows with empty artist', async () => {
      const raw: FetchedSource = {
        kind: 'csv',
        body: [
          '"Date","Artist","Venue","Time","Genre","URL"',
          '"20/06/2026","","The Swan, Stone","9pm","",""',
        ].join('\n'),
      };

      const result = await klmaStokeAdapter.parse(testConfig, testRun, raw);

      expect(result.events).toHaveLength(0);
      expect(result.parked).toHaveLength(1);
      expect(result.parked[0].reason).toBe('non_artist_event');
    });

    it('should handle multiple rows with mixed outcomes', async () => {
      const raw: FetchedSource = {
        kind: 'csv',
        body: [
          '"Date","Artist","Venue","Time","Genre","URL"',
          '"20/06/2026","Good Artist","The Swan, Stone","9pm","Rock",""',
          '"21/06/2026","Another Artist","Artisan Tap","8pm","Jazz",""',
          '"22/06/2026","","Empty Venue","7pm","",""',
        ].join('\n'),
      };

      const result = await klmaStokeAdapter.parse(testConfig, testRun, raw);

      expect(result.events).toHaveLength(1);
      expect(result.parked).toHaveLength(2);
    });
  });
});
