/**
 * S3SourceRunStorage Tests
 *
 * Tests for the S3 implementation of SourceRunStorage.
 * Uses prefix: source-runs/{sourceId}/{runDate}/
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3SourceRunStorage } from './S3SourceRunStorage';
import { SourceConfig, SourceRun, NormalisedEvent, EventDiffReport } from '../types';
import { FetchedSource, ParsedSource } from '../runner';

// Mock AWS SDK
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  ListObjectsV2Command: vi.fn().mockImplementation((input) => ({ input })),
}));

const createConfig = (): SourceConfig => ({
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
  parkingLot: { specialistVenueSlugs: [], multiActVenueSlugs: [], reasons: [] },
  thresholds: {
    venueAutoMatch: 0.95,
    artistAutoMatch: 0.9,
    eventAutoCreate: 0.95,
    socialAutoAttach: 0.95,
  },
  snapshotSemantics: 'complete',
});

const createRun = (): SourceRun => ({
  runId: 'run-2026-06-14-001',
  sourceId: 'klma-stoke-gig-list',
  runDate: '2026-06-14',
  startedAt: '2026-06-14T09:00:00Z',
  status: 'running',
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
});

const createEvent = (): NormalisedEvent => ({
  sourceId: 'klma-stoke-gig-list',
  externalId: 'klma-event-123',
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
});

describe('S3SourceRunStorage', () => {
  const bucketName = 'bndy-signals-dev-123456';
  let storage: S3SourceRunStorage;

  beforeEach(() => {
    storage = new S3SourceRunStorage(bucketName);
    mockSend.mockReset();
  });

  describe('writeRawSnapshot', () => {
    it('should write raw CSV to S3 with correct key', async () => {
      const config = createConfig();
      const run = createRun();
      const data: FetchedSource = {
        kind: 'csv',
        body: 'date,venue,artist\n20/06/2026,The Swan,Test Artist',
      };

      mockSend.mockResolvedValueOnce({});

      await storage.writeRawSnapshot(config, run, data);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.Bucket).toBe(bucketName);
      expect(command.input.Key).toBe(
        'source-runs/klma-stoke-gig-list/2026-06-14/raw/snapshot.csv'
      );
      expect(command.input.Body).toBe(data.body);
      expect(command.input.ContentType).toBe('text/csv');
    });

    it('should write JSON with correct content type', async () => {
      const config = createConfig();
      const run = createRun();
      const data: FetchedSource = {
        kind: 'json',
        body: '{"events": []}',
      };

      mockSend.mockResolvedValueOnce({});

      await storage.writeRawSnapshot(config, run, data);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Key).toBe(
        'source-runs/klma-stoke-gig-list/2026-06-14/raw/snapshot.json'
      );
      expect(command.input.ContentType).toBe('application/json');
    });
  });

  describe('writeNormalisedOutputs', () => {
    it('should write events and parked rows to S3', async () => {
      const config = createConfig();
      const run = createRun();
      const parsed: ParsedSource = {
        events: [createEvent()],
        parked: [{ reason: 'specialist_venue', row: {} }],
      };

      mockSend.mockResolvedValue({});

      await storage.writeNormalisedOutputs(config, run, parsed);

      // Should write both events.json and parked.json
      expect(mockSend).toHaveBeenCalledTimes(2);

      const eventsCommand = mockSend.mock.calls[0][0];
      expect(eventsCommand.input.Key).toBe(
        'source-runs/klma-stoke-gig-list/2026-06-14/normalised/events.json'
      );

      const parkedCommand = mockSend.mock.calls[1][0];
      expect(parkedCommand.input.Key).toBe(
        'source-runs/klma-stoke-gig-list/2026-06-14/normalised/parked.json'
      );
    });
  });

  describe('writeDiffReport', () => {
    it('should write diff report to S3', async () => {
      const config = createConfig();
      const run = createRun();
      const diff: EventDiffReport = {
        sourceId: 'klma-stoke-gig-list',
        runDate: '2026-06-14',
        added: [createEvent()],
        cancelledCandidates: [],
        unchanged: [],
        pastDropped: [],
        absencesForReview: [],
      };

      mockSend.mockResolvedValueOnce({});

      await storage.writeDiffReport(config, run, diff);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.Key).toBe(
        'source-runs/klma-stoke-gig-list/2026-06-14/diff/report.json'
      );
    });
  });

  describe('loadPreviousNormalisedEvents', () => {
    it('should load events from previous run', async () => {
      const config = createConfig();
      const run = createRun();
      const previousEvents = [createEvent()];

      // Mock list to find previous run
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'source-runs/klma-stoke-gig-list/2026-06-13/normalised/events.json' },
        ],
      });

      // Mock get to return events
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToString: async () => JSON.stringify(previousEvents),
        },
      });

      const result = await storage.loadPreviousNormalisedEvents(config, run);

      expect(result).toHaveLength(1);
      expect(result[0].externalId).toBe('klma-event-123');
    });

    it('should return empty array if no previous run exists', async () => {
      const config = createConfig();
      const run = createRun();

      // Mock list with no results
      mockSend.mockResolvedValueOnce({
        Contents: [],
      });

      const result = await storage.loadPreviousNormalisedEvents(config, run);

      expect(result).toEqual([]);
    });

    it('should skip current run date when finding previous', async () => {
      const config = createConfig();
      const run = createRun();

      // Mock list with current and previous run
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'source-runs/klma-stoke-gig-list/2026-06-14/normalised/events.json' }, // Current
          { Key: 'source-runs/klma-stoke-gig-list/2026-06-13/normalised/events.json' }, // Previous
        ],
      });

      // Mock get for previous run
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToString: async () => JSON.stringify([createEvent()]),
        },
      });

      const result = await storage.loadPreviousNormalisedEvents(config, run);

      // Should have loaded from 2026-06-13, not 2026-06-14
      expect(result).toHaveLength(1);
    });
  });

  describe('key generation', () => {
    it('should use correct prefix pattern', async () => {
      const config = createConfig();
      const run = createRun();

      mockSend.mockResolvedValueOnce({});

      await storage.writeRawSnapshot(config, run, { kind: 'csv', body: 'test' });

      const command = mockSend.mock.calls[0][0];
      // Pattern: source-runs/{sourceId}/{runDate}/{type}/{filename}
      expect(command.input.Key).toMatch(
        /^source-runs\/klma-stoke-gig-list\/2026-06-14\/raw\/snapshot\.csv$/
      );
    });
  });
});
