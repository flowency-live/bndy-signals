/**
 * Runner composition root
 *
 * Wires the real implementations into the RunnerDependencies the generic
 * runner (runner.ts `runSource`) expects. This is the production "wiring"
 * that turns the tested-with-mocks pipeline into something the CLI can run.
 *
 * Source-agnostic: it resolves the adapter from the registry by sourceId.
 * Adding a source = implement + register an adapter; nothing here changes.
 *
 * Storage mode:
 *  - In-memory run storage + run-lifecycle store (default) — no AWS needed,
 *    correct for dry-runs and manual capped writes. Resolution state is an
 *    InMemorySourceStateStore (idempotency holds within a single run; across
 *    runs, bndy's by-external-id lookups still prevent duplicates).
 *  - Persistent S3/Dynamo wiring is a follow-up for the scheduled cutover
 *    (cross-run state + snapshot history). See deploy-work-order Step 7.
 */

import { randomUUID } from 'crypto';

import {
  RunnerDependencies,
  SourceRunStorage,
  SourceStateStore as RunLifecycleStore,
  FetchedSource,
  ParsedSource,
  WriteResult,
} from '../runner';
import {
  SourceConfig,
  SourceRun,
  SourceRunCounts,
  RunSourceOptions,
  EventDiffReport,
  NormalisedEvent,
  ReviewItem,
} from '../types';

import { loadSourceConfig } from '../config/loadSourceConfig';
import { getSourceAdapter } from '../adapter/SourceAdapter';
import { diffEvents, createDiffReport } from '../diff/diffEvents';
import { resolveEntities } from '../resolution/resolveEntities';
import { InMemorySourceStateStore } from '../resolution/SourceStateStore';
import { applyWrites } from '../bndy-client/applyWrites';
import { HttpBndyWriteClient } from '../bndy-client/HttpBndyWriteClient';
import { S3SourceRunStorage } from '../storage/S3SourceRunStorage';
import { S3RunLifecycleStore } from '../storage/S3RunLifecycleStore';

// Side-effect imports: register source adapters into the registry.
import '../sources/klma-stoke/adapter';

const DEFAULT_BNDY_API_BASE_URL = 'https://api.bndy.co.uk';
const DEFAULT_SOURCE_RUNS_BUCKET = 'bndy-signals-dev-771551874768';

function emptyCounts(): SourceRunCounts {
  return {
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
  };
}

/**
 * In-memory run storage. Snapshots/outputs are no-ops (nothing to persist for a
 * dry-run / manual run); `loadPreviousNormalisedEvents` returns the seed (empty
 * on a true first run → everything is "added").
 */
class InMemoryRunStorage implements SourceRunStorage {
  constructor(private readonly previous: NormalisedEvent[] = []) {}

  async writeRawSnapshot(_config: SourceConfig, _run: SourceRun, _data: FetchedSource): Promise<void> {}

  async writeNormalisedOutputs(_config: SourceConfig, _run: SourceRun, _parsed: ParsedSource): Promise<void> {}

  async writeDiffReport(_config: SourceConfig, _run: SourceRun, _diff: EventDiffReport): Promise<void> {}

  async writeReviewItems(_config: SourceConfig, _run: SourceRun, _items: ReviewItem[]): Promise<string> {
    return 'memory://review/items.json';
  }

  async loadPreviousNormalisedEvents(_config: SourceConfig, _run: SourceRun): Promise<NormalisedEvent[]> {
    return this.previous;
  }
}

/**
 * In-memory run-lifecycle store (startRun / completeRun / persistRunState).
 * Run records live only for the duration of the process.
 */
class InMemoryRunLifecycleStore implements RunLifecycleStore {
  async startRun(config: SourceConfig, options: RunSourceOptions): Promise<SourceRun> {
    return {
      sourceId: config.id,
      runId: randomUUID(),
      runDate: options.date,
      startedAt: new Date().toISOString(),
      status: 'started',
      counts: emptyCounts(),
      errors: [],
    };
  }

  async completeRun(_config: SourceConfig, _run: SourceRun, _reportPath?: string): Promise<void> {}

  async persistRunState(_config: SourceConfig, _run: SourceRun, _result: WriteResult): Promise<void> {}
}

/**
 * Build the production RunnerDependencies for a source.
 *
 * @param options Parsed CLI options (sourceId, date, dryRun, maxWrites, …).
 * @param seedPreviousEvents Optional prior normalised events (for local diff testing).
 */
export async function createRunnerDependencies(
  options: RunSourceOptions,
  seedPreviousEvents: NormalisedEvent[] = []
): Promise<RunnerDependencies> {
  // Load + validate config up-front so the closures below can use it.
  const config = await loadSourceConfig(options.sourceId);

  const adapter = getSourceAdapter(options.sourceId);
  if (!adapter) {
    throw new Error(
      `No source adapter registered for "${options.sourceId}". ` +
        `Implement + register one under sources/${options.sourceId}/.`
    );
  }

  const baseUrl = process.env.BNDY_API_BASE_URL ?? DEFAULT_BNDY_API_BASE_URL;
  const client = new HttpBndyWriteClient(baseUrl);
  const resolutionState = new InMemorySourceStateStore();

  // Use S3 storage for persistence (enables cross-run diffing).
  // Falls back to in-memory if BNDY_SOURCE_RUNS_BUCKET=none (for tests).
  const bucketName = process.env.BNDY_SOURCE_RUNS_BUCKET ?? DEFAULT_SOURCE_RUNS_BUCKET;
  const storage: SourceRunStorage =
    bucketName === 'none'
      ? new InMemoryRunStorage(seedPreviousEvents)
      : new S3SourceRunStorage(bucketName);
  // Use S3 lifecycle store for persistence (enables source dashboard).
  // Falls back to in-memory if BNDY_SOURCE_RUNS_BUCKET=none (for tests/dry-runs).
  const stateStore: RunLifecycleStore =
    bucketName === 'none'
      ? new InMemoryRunLifecycleStore()
      : new S3RunLifecycleStore(bucketName);

  return {
    loadSourceConfig: async () => config,
    fetchSource: (c, run) => adapter.fetch(c, run),
    parseSource: (c, run, raw) => adapter.parse(c, run, raw),
    diffEvents: async (prior, current, runDate) =>
      createDiffReport(
        config.id,
        runDate,
        undefined,
        diffEvents(prior, current, runDate, config.snapshotSemantics)
      ),
    // ADR-021: canCreate=false → runner returns REVIEW for new entities (never auto-create).
    // Review items are persisted to S3 (review/items.json) for HITL or intelligence pass.
    // Server-side find-or-create is only called for matched entities via delegation.
    resolveEntities: (c, diff) => resolveEntities(c, diff, { stateStore: resolutionState, client, canCreate: false }),
    applyWrites: (c, run, resolved, applyOptions) =>
      applyWrites(client, c, run, resolved, applyOptions),
    generateReport: async () => `memory://reports/${config.id}/run.json`,
    storage,
    stateStore,
  };
}
