/**
 * Event Diff Module
 *
 * Compares normalised events between runs to determine:
 * - added: new events in current run
 * - cancelledCandidates: future events missing from current run (complete snapshots only)
 * - pastDropped: past events missing from current run (complete snapshots only)
 * - absencesForReview: missing events for incremental sources (needs human review)
 * - unchanged: events present in both runs
 *
 * Behavior varies by snapshotSemantics:
 * - complete: full snapshot, can infer cancellations (KLMA CSV)
 * - incremental: partial/paginated, route absences to review
 * - one_shot: single paste, never infer cancellations
 */

import { NormalisedEvent, EventDiffReport, SnapshotSemantics } from '../types';

export interface DiffResult {
  added: NormalisedEvent[];
  cancelledCandidates: NormalisedEvent[];
  unchanged: NormalisedEvent[];
  pastDropped: NormalisedEvent[];
  absencesForReview: NormalisedEvent[];
}

/**
 * Diff normalised events between previous and current runs.
 *
 * @param previous - Events from the previous run
 * @param current - Events from the current run
 * @param runDate - Current run date (YYYY-MM-DD) for past/future determination
 * @param snapshotSemantics - How to handle missing events (default: complete)
 * @returns DiffResult with categorised events
 */
export function diffEvents(
  previous: NormalisedEvent[],
  current: NormalisedEvent[],
  runDate: string,
  snapshotSemantics: SnapshotSemantics = 'complete'
): DiffResult {
  // Build lookup maps by externalId
  const previousMap = new Map<string, NormalisedEvent>();
  for (const event of previous) {
    // Keep first occurrence (dedup)
    if (!previousMap.has(event.externalId)) {
      previousMap.set(event.externalId, event);
    }
  }

  const currentMap = new Map<string, NormalisedEvent>();
  for (const event of current) {
    // Keep first occurrence (dedup)
    if (!currentMap.has(event.externalId)) {
      currentMap.set(event.externalId, event);
    }
  }

  const added: NormalisedEvent[] = [];
  const unchanged: NormalisedEvent[] = [];
  const cancelledCandidates: NormalisedEvent[] = [];
  const pastDropped: NormalisedEvent[] = [];
  const absencesForReview: NormalisedEvent[] = [];

  // Check current events against previous
  for (const [externalId, event] of currentMap) {
    if (previousMap.has(externalId)) {
      unchanged.push(event);
    } else {
      added.push(event);
    }
  }

  // Check previous events missing from current
  // Behavior depends on snapshotSemantics
  for (const [externalId, event] of previousMap) {
    if (!currentMap.has(externalId)) {
      switch (snapshotSemantics) {
        case 'complete':
          // Full snapshot - can infer cancellations
          if (event.date > runDate) {
            cancelledCandidates.push(event);
          } else {
            pastDropped.push(event);
          }
          break;

        case 'one_shot':
          // Single paste - never infer cancellations
          // Absences are expected; don't record them
          break;

        case 'incremental':
          // Partial/paginated - route all absences to review
          absencesForReview.push(event);
          break;
      }
    }
  }

  return {
    added,
    cancelledCandidates,
    unchanged,
    pastDropped,
    absencesForReview,
  };
}

/**
 * Create a full EventDiffReport from diff results.
 */
export function createDiffReport(
  sourceId: string,
  runDate: string,
  priorRunDate: string | undefined,
  diffResult: DiffResult
): EventDiffReport {
  return {
    sourceId,
    runDate,
    priorRunDate,
    added: diffResult.added,
    cancelledCandidates: diffResult.cancelledCandidates,
    unchanged: diffResult.unchanged,
    pastDropped: diffResult.pastDropped,
  };
}
