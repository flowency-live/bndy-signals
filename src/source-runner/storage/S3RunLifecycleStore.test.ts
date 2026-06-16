/**
 * S3RunLifecycleStore Tests
 *
 * Tests for the S3 implementation of SourceStateStore (run lifecycle).
 * Writes run records to: source-runs/{sourceId}/{runDate}/run.json
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3RunLifecycleStore } from './S3RunLifecycleStore';
import { SourceConfig, SourceRun, RunSourceOptions, SourceRunCounts } from '../types';
import { WriteResult } from '../runner';

// Mock AWS SDK
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
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

const createOptions = (): RunSourceOptions => ({
  sourceId: 'klma-stoke-gig-list',
  date: '2026-06-14',
  dryRun: false,
  localStorage: false,
  reviewOnly: false,
});

const emptyCounts = (): SourceRunCounts => ({
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
});

describe('S3RunLifecycleStore', () => {
  const bucketName = 'bndy-signals-dev-123456';
  let store: S3RunLifecycleStore;

  beforeEach(() => {
    store = new S3RunLifecycleStore(bucketName);
    mockSend.mockReset();
  });

  describe('startRun', () => {
    it('should create a run record with status started', async () => {
      const config = createConfig();
      const options = createOptions();

      const run = await store.startRun(config, options);

      expect(run.sourceId).toBe('klma-stoke-gig-list');
      expect(run.runDate).toBe('2026-06-14');
      expect(run.status).toBe('started');
      expect(run.runId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
      expect(run.errors).toEqual([]);
    });

    it('should initialize counts to zero', async () => {
      const config = createConfig();
      const options = createOptions();

      const run = await store.startRun(config, options);

      expect(run.counts).toEqual(emptyCounts());
    });
  });

  describe('completeRun', () => {
    it('should write run.json to S3 at correct path', async () => {
      const config = createConfig();
      const run: SourceRun = {
        sourceId: 'klma-stoke-gig-list',
        runId: 'run-123',
        runDate: '2026-06-14',
        startedAt: '2026-06-14T09:00:00Z',
        status: 'completed',
        counts: emptyCounts(),
        errors: [],
      };

      mockSend.mockResolvedValueOnce({});

      await store.completeRun(config, run);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.Bucket).toBe(bucketName);
      expect(command.input.Key).toBe(
        'source-runs/klma-stoke-gig-list/2026-06-14/run.json'
      );
      expect(command.input.ContentType).toBe('application/json');
    });

    it('should set completedAt timestamp if not already set', async () => {
      const config = createConfig();
      const run: SourceRun = {
        sourceId: 'klma-stoke-gig-list',
        runId: 'run-123',
        runDate: '2026-06-14',
        startedAt: '2026-06-14T09:00:00Z',
        status: 'completed',
        counts: emptyCounts(),
        errors: [],
      };

      mockSend.mockResolvedValueOnce({});

      await store.completeRun(config, run);

      const command = mockSend.mock.calls[0][0];
      const body = JSON.parse(command.input.Body);
      expect(body.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should preserve existing completedAt if already set', async () => {
      const config = createConfig();
      const run: SourceRun = {
        sourceId: 'klma-stoke-gig-list',
        runId: 'run-123',
        runDate: '2026-06-14',
        startedAt: '2026-06-14T09:00:00Z',
        completedAt: '2026-06-14T09:05:00Z',
        status: 'completed',
        counts: emptyCounts(),
        errors: [],
      };

      mockSend.mockResolvedValueOnce({});

      await store.completeRun(config, run);

      const command = mockSend.mock.calls[0][0];
      const body = JSON.parse(command.input.Body);
      expect(body.completedAt).toBe('2026-06-14T09:05:00Z');
    });

    it('should persist failed runs with status and errors', async () => {
      const config = createConfig();
      const run: SourceRun = {
        sourceId: 'klma-stoke-gig-list',
        runId: 'run-123',
        runDate: '2026-06-14',
        startedAt: '2026-06-14T09:00:00Z',
        status: 'failed',
        counts: emptyCounts(),
        errors: [
          {
            code: 'FETCH_FAILED',
            message: 'Could not fetch source data',
            timestamp: '2026-06-14T09:01:00Z',
          },
        ],
      };

      mockSend.mockResolvedValueOnce({});

      await store.completeRun(config, run);

      const command = mockSend.mock.calls[0][0];
      const body = JSON.parse(command.input.Body);
      expect(body.status).toBe('failed');
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].code).toBe('FETCH_FAILED');
    });

    it('should include all counts in persisted record', async () => {
      const config = createConfig();
      const counts: SourceRunCounts = {
        rawRows: 100,
        validEvents: 80,
        metadataRows: 10,
        parkedRows: 10,
        added: 5,
        cancelled: 2,
        unchanged: 73,
        pastDropped: 0,
        eventsCreated: 5,
        eventsRepointed: 0,
        eventsDeleted: 0,
        eventsHidden: 2,
        venuesCreated: 1,
        venuesMatched: 4,
        artistsCreated: 0,
        artistsMatched: 5,
        reviewItems: 3,
      };
      const run: SourceRun = {
        sourceId: 'klma-stoke-gig-list',
        runId: 'run-123',
        runDate: '2026-06-14',
        startedAt: '2026-06-14T09:00:00Z',
        status: 'completed',
        counts,
        errors: [],
      };

      mockSend.mockResolvedValueOnce({});

      await store.completeRun(config, run);

      const command = mockSend.mock.calls[0][0];
      const body = JSON.parse(command.input.Body);
      expect(body.counts).toEqual(counts);
    });
  });

  describe('persistRunState', () => {
    it('should be a no-op (state accumulated in run object)', async () => {
      const config = createConfig();
      const run: SourceRun = {
        sourceId: 'klma-stoke-gig-list',
        runId: 'run-123',
        runDate: '2026-06-14',
        startedAt: '2026-06-14T09:00:00Z',
        status: 'started',
        counts: emptyCounts(),
        errors: [],
      };
      const result: WriteResult = {
        created: [],
        updated: [],
        deleted: [],
        failed: [],
      };

      // Should not throw
      await store.persistRunState(config, run, result);

      // No S3 writes expected - state is accumulated in the run object
      // and written once on completeRun
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('key generation', () => {
    it('should use correct prefix pattern', async () => {
      const config = createConfig();
      const run: SourceRun = {
        sourceId: 'klma-stoke-gig-list',
        runId: 'run-123',
        runDate: '2026-06-14',
        startedAt: '2026-06-14T09:00:00Z',
        status: 'completed',
        counts: emptyCounts(),
        errors: [],
      };

      mockSend.mockResolvedValueOnce({});

      await store.completeRun(config, run);

      const command = mockSend.mock.calls[0][0];
      // Pattern: source-runs/{sourceId}/{runDate}/run.json
      expect(command.input.Key).toMatch(
        /^source-runs\/klma-stoke-gig-list\/2026-06-14\/run\.json$/
      );
    });

    it('should support custom prefix', async () => {
      const customStore = new S3RunLifecycleStore(bucketName, 'eu-west-2', 'custom-prefix');
      const config = createConfig();
      const run: SourceRun = {
        sourceId: 'klma-stoke-gig-list',
        runId: 'run-123',
        runDate: '2026-06-14',
        startedAt: '2026-06-14T09:00:00Z',
        status: 'completed',
        counts: emptyCounts(),
        errors: [],
      };

      mockSend.mockResolvedValueOnce({});

      await customStore.completeRun(config, run);

      const command = mockSend.mock.calls[0][0];
      expect(command.input.Key).toBe('custom-prefix/klma-stoke-gig-list/2026-06-14/run.json');
    });
  });
});
