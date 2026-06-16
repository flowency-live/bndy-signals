import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { runSource, RunnerDependencies, RunnerStep } from './runner';
import { SourceConfig, RunSourceOptions, SourceRunResult } from './types';

// Mock dependencies
const createMockDependencies = (): RunnerDependencies => ({
  loadSourceConfig: vi.fn(),
  fetchSource: vi.fn(),
  parseSource: vi.fn(),
  diffEvents: vi.fn(),
  resolveEntities: vi.fn(),
  applyWrites: vi.fn(),
  generateReport: vi.fn(),
  storage: {
    writeRawSnapshot: vi.fn(),
    writeNormalisedOutputs: vi.fn(),
    writeDiffReport: vi.fn(),
    loadPreviousNormalisedEvents: vi.fn(),
  },
  stateStore: {
    startRun: vi.fn(),
    completeRun: vi.fn(),
    persistRunState: vi.fn(),
  },
});

const createMockConfig = (): SourceConfig => ({
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
    sheetId: '1atEqyN-RI1smTzSaCtMUSui7oNp2dhCpiGoAfY5ySno',
    gid: '831966245',
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
    reasons: ['specialist_venue', 'multi_act'],
  },
  thresholds: {
    venueAutoMatch: 0.95,
    artistAutoMatch: 0.9,
    eventAutoCreate: 0.95,
    socialAutoAttach: 0.95,
  },
});

const createMockOptions = (overrides?: Partial<RunSourceOptions>): RunSourceOptions => ({
  sourceId: 'klma-stoke-gig-list',
  date: '2026-06-14',
  dryRun: false,
  localStorage: true,
  reviewOnly: false,
  ...overrides,
});

describe('runSource', () => {
  let deps: RunnerDependencies;
  let config: SourceConfig;

  beforeEach(() => {
    deps = createMockDependencies();
    config = createMockConfig();

    // Setup default mock returns
    (deps.loadSourceConfig as Mock).mockResolvedValue(config);
    (deps.stateStore.startRun as Mock).mockResolvedValue({
      sourceId: 'klma-stoke-gig-list',
      runId: 'run_abc123',
      runDate: '2026-06-14',
      startedAt: '2026-06-14T09:00:00Z',
      status: 'started',
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
    (deps.fetchSource as Mock).mockResolvedValue({ kind: 'csv', body: 'date,artist,venue,time,genre,url\n' });
    (deps.parseSource as Mock).mockResolvedValue({ events: [], parked: [] });
    (deps.storage.loadPreviousNormalisedEvents as Mock).mockResolvedValue([]);
    (deps.diffEvents as Mock).mockResolvedValue({ added: [], cancelledCandidates: [], unchanged: [], pastDropped: [] });
    (deps.resolveEntities as Mock).mockResolvedValue({ resolved: [], reviewItems: [] });
    (deps.applyWrites as Mock).mockResolvedValue({ success: true, counts: {} });
    (deps.generateReport as Mock).mockResolvedValue('/path/to/report.md');
  });

  describe('orchestration', () => {
    it('should execute steps in correct order', async () => {
      const callOrder: string[] = [];

      (deps.loadSourceConfig as Mock).mockImplementation(async () => {
        callOrder.push('loadSourceConfig');
        return config;
      });
      (deps.stateStore.startRun as Mock).mockImplementation(async () => {
        callOrder.push('startRun');
        return { sourceId: 'test', runId: 'run_1', runDate: '2026-06-14', startedAt: new Date().toISOString(), status: 'started', counts: {}, errors: [] };
      });
      (deps.fetchSource as Mock).mockImplementation(async () => {
        callOrder.push('fetchSource');
        return { kind: 'csv', body: '' };
      });
      (deps.storage.writeRawSnapshot as Mock).mockImplementation(async () => {
        callOrder.push('writeRawSnapshot');
      });
      (deps.parseSource as Mock).mockImplementation(async () => {
        callOrder.push('parseSource');
        return { events: [], parked: [] };
      });
      (deps.storage.writeNormalisedOutputs as Mock).mockImplementation(async () => {
        callOrder.push('writeNormalisedOutputs');
      });
      (deps.storage.loadPreviousNormalisedEvents as Mock).mockImplementation(async () => {
        callOrder.push('loadPreviousNormalisedEvents');
        return [];
      });
      (deps.diffEvents as Mock).mockImplementation(async () => {
        callOrder.push('diffEvents');
        return { added: [], cancelledCandidates: [], unchanged: [], pastDropped: [] };
      });
      (deps.storage.writeDiffReport as Mock).mockImplementation(async () => {
        callOrder.push('writeDiffReport');
      });
      (deps.resolveEntities as Mock).mockImplementation(async () => {
        callOrder.push('resolveEntities');
        return { resolved: [], reviewItems: [] };
      });
      (deps.applyWrites as Mock).mockImplementation(async () => {
        callOrder.push('applyWrites');
        return { success: true, counts: {} };
      });
      (deps.stateStore.persistRunState as Mock).mockImplementation(async () => {
        callOrder.push('persistRunState');
      });
      (deps.generateReport as Mock).mockImplementation(async () => {
        callOrder.push('generateReport');
        return '/path/report.md';
      });
      (deps.stateStore.completeRun as Mock).mockImplementation(async () => {
        callOrder.push('completeRun');
      });

      await runSource(createMockOptions(), deps);

      expect(callOrder).toEqual([
        'loadSourceConfig',
        'startRun',
        'fetchSource',
        'writeRawSnapshot',
        'parseSource',
        'writeNormalisedOutputs',
        'loadPreviousNormalisedEvents',
        'diffEvents',
        'writeDiffReport',
        'resolveEntities',
        'applyWrites',
        'persistRunState',
        'generateReport',
        'completeRun',
      ]);
    });

    it('should skip write steps in dry-run mode', async () => {
      const options = createMockOptions({ dryRun: true });

      await runSource(options, deps);

      expect(deps.applyWrites).not.toHaveBeenCalled();
      expect(deps.stateStore.persistRunState).not.toHaveBeenCalled();
    });

    it('should skip write steps in review-only mode', async () => {
      const options = createMockOptions({ reviewOnly: true, dryRun: false });

      await runSource(options, deps);

      expect(deps.applyWrites).not.toHaveBeenCalled();
    });

    it('should return SourceRunResult on success', async () => {
      const result = await runSource(createMockOptions(), deps);

      expect(result).toHaveProperty('run');
      expect(result).toHaveProperty('diff');
      expect(result).toHaveProperty('reviewItems');
      expect(result).toHaveProperty('reportPath');
    });
  });

  describe('error handling', () => {
    it('should throw on config load failure', async () => {
      (deps.loadSourceConfig as Mock).mockRejectedValue(new Error('Config not found'));

      await expect(runSource(createMockOptions(), deps)).rejects.toThrow('Config not found');
    });

    it('should set status to download_failed on fetch error', async () => {
      (deps.fetchSource as Mock).mockRejectedValue(new Error('Download failed'));

      const result = await runSource(createMockOptions(), deps);

      expect(result.run.status).toBe('download_failed');
      expect(result.run.errors).toHaveLength(1);
      expect(result.run.errors[0].code).toBe('DOWNLOAD_FAILED');
    });

    it('should set status to parse_failed on parse error', async () => {
      (deps.parseSource as Mock).mockRejectedValue(new Error('Parse error'));

      const result = await runSource(createMockOptions(), deps);

      expect(result.run.status).toBe('parse_failed');
    });
  });

  describe('safety caps', () => {
    it('should respect maxWrites option', async () => {
      const options = createMockOptions({ maxWrites: 10 });

      await runSource(options, deps);

      expect(deps.applyWrites).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ maxWrites: 10 })
      );
    });
  });
});

describe('RunnerStep type', () => {
  it('should define all required steps', () => {
    const steps: RunnerStep[] = [
      'load_config',
      'start_run',
      'fetch_source',
      'store_snapshot',
      'parse_source',
      'store_normalised',
      'load_previous',
      'diff_events',
      'store_diff',
      'resolve_entities',
      'apply_writes',
      'persist_state',
      'generate_report',
      'complete_run',
    ];

    expect(steps).toHaveLength(14);
  });
});
