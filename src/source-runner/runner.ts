/**
 * bndy Source Runner
 *
 * Main orchestration for source imports. Executes the full pipeline:
 * fetch → parse → diff → resolve → write → report
 *
 * Dependency injection allows for testing and different storage backends.
 */

import {
  SourceConfig,
  RunSourceOptions,
  SourceRun,
  SourceRunResult,
  SourceRunStatus,
  SourceRunError,
  SourceRunCounts,
  NormalisedEvent,
  EventDiffReport,
  ReviewItem,
  SafetyCaps,
  DEFAULT_SAFETY_CAPS,
} from './types';

// -----------------------------------------------------------------------------
// Runner Steps
// -----------------------------------------------------------------------------

export type RunnerStep =
  | 'load_config'
  | 'start_run'
  | 'fetch_source'
  | 'store_snapshot'
  | 'parse_source'
  | 'store_normalised'
  | 'load_previous'
  | 'diff_events'
  | 'store_diff'
  | 'resolve_entities'
  | 'apply_writes'
  | 'persist_state'
  | 'generate_report'
  | 'complete_run';

// -----------------------------------------------------------------------------
// Dependency Interfaces
// -----------------------------------------------------------------------------

export interface FetchedSource {
  kind: 'csv' | 'json' | 'html'; // html for JS-rendered pages (On The Case)
  body: string;
  originalBody?: string;
  fetchMethod?: string;
  fetchedAt?: string;
}

export interface ParsedSource {
  events: NormalisedEvent[];
  parked: unknown[];
}

export interface ResolvedEntities {
  resolved: Array<{
    event: NormalisedEvent;
    venueId?: string;
    artistId?: string;
    action: 'create' | 'repoint' | 'skip' | 'review';
  }>;
  reviewItems: ReviewItem[];
}

export interface WriteResult {
  success: boolean;
  counts: Partial<SourceRunCounts>;
  errors?: SourceRunError[];
  /**
   * Review items produced during the write stage (find-or-create returned no-match under
   * canCreate:false, or delete→hide). MUST be merged + persisted by the runner — otherwise the
   * gig is silently lost and the intelligence pass has nothing to resolve.
   */
  reviewItems?: ReviewItem[];
}

export interface SourceRunStorage {
  writeRawSnapshot(config: SourceConfig, run: SourceRun, data: FetchedSource): Promise<void>;
  writeNormalisedOutputs(config: SourceConfig, run: SourceRun, parsed: ParsedSource): Promise<void>;
  writeDiffReport(config: SourceConfig, run: SourceRun, diff: EventDiffReport): Promise<void>;
  writeReviewItems(config: SourceConfig, run: SourceRun, items: ReviewItem[]): Promise<string>;
  loadPreviousNormalisedEvents(config: SourceConfig, run: SourceRun): Promise<NormalisedEvent[]>;
}

export interface SourceStateStore {
  startRun(config: SourceConfig, options: RunSourceOptions): Promise<SourceRun>;
  completeRun(config: SourceConfig, run: SourceRun, reportPath?: string): Promise<void>;
  persistRunState(config: SourceConfig, run: SourceRun, result: WriteResult): Promise<void>;
}

export interface ApplyWritesOptions {
  dryRun: boolean;
  maxWrites?: number;
  reviewOnly: boolean;
  safetyCaps: SafetyCaps;
}

export interface RunnerDependencies {
  loadSourceConfig: (sourceId: string) => Promise<SourceConfig>;
  fetchSource: (config: SourceConfig, run: SourceRun) => Promise<FetchedSource>;
  parseSource: (config: SourceConfig, run: SourceRun, raw: FetchedSource) => Promise<ParsedSource>;
  diffEvents: (prior: NormalisedEvent[], current: NormalisedEvent[], runDate: string) => Promise<EventDiffReport>;
  resolveEntities: (config: SourceConfig, diff: EventDiffReport) => Promise<ResolvedEntities>;
  applyWrites: (
    config: SourceConfig,
    run: SourceRun,
    resolved: ResolvedEntities,
    options: ApplyWritesOptions
  ) => Promise<WriteResult>;
  generateReport: (
    config: SourceConfig,
    run: SourceRun,
    diff: EventDiffReport,
    writeResult: WriteResult
  ) => Promise<string>;
  storage: SourceRunStorage;
  stateStore: SourceStateStore;
}

// -----------------------------------------------------------------------------
// Runner Implementation
// -----------------------------------------------------------------------------

function createEmptyCounts(): SourceRunCounts {
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

function createError(code: string, message: string, details?: unknown): SourceRunError {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

export async function runSource(
  options: RunSourceOptions,
  deps: RunnerDependencies
): Promise<SourceRunResult> {
  // Step 1: Load config
  const config = await deps.loadSourceConfig(options.sourceId);

  // Step 2: Start run
  let run = await deps.stateStore.startRun(config, options);
  let diff: EventDiffReport | undefined;
  let reviewItems: ReviewItem[] = [];
  let reportPath: string | undefined;

  try {
    // Step 3: Fetch source
    let raw: FetchedSource;
    try {
      raw = await deps.fetchSource(config, run);
    } catch (error) {
      run = {
        ...run,
        status: 'download_failed' as SourceRunStatus,
        errors: [
          ...run.errors,
          createError(
            'DOWNLOAD_FAILED',
            error instanceof Error ? error.message : 'Download failed'
          ),
        ],
      };
      return { run, reviewItems, reportPath };
    }

    // Step 4: Store raw snapshot
    await deps.storage.writeRawSnapshot(config, run, raw);

    // Step 5: Parse source
    let parsed: ParsedSource;
    try {
      parsed = await deps.parseSource(config, run, raw);
    } catch (error) {
      run = {
        ...run,
        status: 'parse_failed' as SourceRunStatus,
        errors: [
          ...run.errors,
          createError(
            'PARSE_FAILED',
            error instanceof Error ? error.message : 'Parse failed'
          ),
        ],
      };
      return { run, reviewItems, reportPath };
    }

    // Step 5b: Update run counts from parse stage (#2 - parse counts)
    run = {
      ...run,
      counts: {
        ...run.counts,
        validEvents: parsed.events.length,
        parkedRows: parsed.parked.length,
      },
    };

    // Step 6: Store normalised outputs
    await deps.storage.writeNormalisedOutputs(config, run, parsed);

    // Step 7: Load previous normalised events
    const prior = await deps.storage.loadPreviousNormalisedEvents(config, run);

    // Step 8: Diff events
    try {
      diff = await deps.diffEvents(prior, parsed.events, run.runDate);
    } catch (error) {
      run = {
        ...run,
        status: 'diff_failed' as SourceRunStatus,
        errors: [
          ...run.errors,
          createError(
            'DIFF_FAILED',
            error instanceof Error ? error.message : 'Diff failed'
          ),
        ],
      };
      return { run, diff, reviewItems, reportPath };
    }

    // Step 9: Store diff report
    await deps.storage.writeDiffReport(config, run, diff);

    // Step 10: Resolve entities
    const resolved = await deps.resolveEntities(config, diff);
    reviewItems = resolved.reviewItems;

    // Step 10b: Persist review items (gate for canCreate:false path)
    // Without this, review items would be dropped and gigs silently lost.
    if (reviewItems.length > 0) {
      await deps.storage.writeReviewItems(config, run, reviewItems);
    }

    // Step 11: Apply writes (skip in dry-run mode AND review-only mode)
    // #3: Guard review-only at runner level, don't rely on applyWrites
    let writeResult: WriteResult = { success: true, counts: {} };
    if (!options.dryRun && !options.reviewOnly) {
      const writeOptions: ApplyWritesOptions = {
        dryRun: options.dryRun,
        maxWrites: options.maxWrites,
        reviewOnly: options.reviewOnly,
        safetyCaps: DEFAULT_SAFETY_CAPS,
      };

      try {
        writeResult = await deps.applyWrites(config, run, resolved, writeOptions);

        // Merge the write-stage review items (artist/venue find-or-create no-match under
        // canCreate:false, delete→hide) with the resolution-stage ones, then re-persist the FULL
        // set. Step 10b only wrote the resolution-stage items (it runs before applyWrites); without
        // this merge the write-stage items are dropped and the intelligence pass sees 0 items.
        if (writeResult.reviewItems && writeResult.reviewItems.length > 0) {
          reviewItems = [...reviewItems, ...writeResult.reviewItems];
          await deps.storage.writeReviewItems(config, run, reviewItems);
        }
      } catch (error) {
        run = {
          ...run,
          status: 'write_failed' as SourceRunStatus,
          errors: [
            ...run.errors,
            createError(
              'WRITE_FAILED',
              error instanceof Error ? error.message : 'Write failed'
            ),
          ],
        };
        return { run, diff, reviewItems, reportPath };
      }
    }

    // Step 12: Persist run state (#4: skip on dry-run to avoid mutating state)
    if (!options.dryRun) {
      await deps.stateStore.persistRunState(config, run, writeResult);
    }

    // Step 13: Generate report
    reportPath = await deps.generateReport(config, run, diff, writeResult);

    // Step 14: Complete run
    run = {
      ...run,
      status: reviewItems.length > 0 ? 'completed_with_review_items' : 'completed',
      completedAt: new Date().toISOString(),
      counts: {
        ...run.counts,
        ...writeResult.counts,
        added: diff.added.length,
        cancelled: diff.cancelledCandidates.length,
        unchanged: diff.unchanged.length,
        pastDropped: diff.pastDropped.length,
        reviewItems: reviewItems.length,
      },
    };

    return { run, diff, reviewItems, reportPath };
  } catch (error) {
    // Unexpected error - mark with appropriate status (#6: don't always label as write_failed)
    // If we got past parse/diff but failed in resolve/report/persist, use completed_with_review_items
    // to indicate partial success, or write_failed if we never got to writes
    const status: SourceRunStatus = diff ? 'completed_with_review_items' : 'write_failed';
    run = {
      ...run,
      status,
      errors: [
        ...run.errors,
        createError(
          'UNEXPECTED_ERROR',
          error instanceof Error ? error.message : 'Unexpected error'
        ),
      ],
    };
    return { run, diff, reviewItems, reportPath };
  } finally {
    // MUST: Always persist run record, including failed runs.
    // This enables the source dashboard to show "what failed" (backlog #65).
    // Wrap in try-catch to not mask original errors.
    try {
      await deps.stateStore.completeRun(config, run, reportPath);
    } catch (completeError) {
      console.error('Failed to persist run record:', completeError);
    }
  }
}
