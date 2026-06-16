/**
 * Event Diff Tests
 *
 * Tests for diffing normalised events between runs.
 * Categories:
 * - added: in current, not in previous
 * - cancelledCandidates: in previous, not in current, future date
 * - pastDropped: in previous, not in current, past date (never delete)
 * - unchanged: in both
 */

import { describe, it, expect } from 'vitest';
import { diffEvents } from './diffEvents';
import { NormalisedEvent, SnapshotSemantics } from '../types';

const createEvent = (overrides: Partial<NormalisedEvent> = {}): NormalisedEvent => ({
  sourceId: 'klma-stoke',
  externalId: 'event-1',
  date: '2026-06-20',
  startTime: '21:00',
  timeProvenance: 'parsed',
  venue: {
    sourceVenueExternalId: 'venue-1',
    sourceName: 'The Swan',
    canonicalName: 'The Swan, Stone',
    city: 'Stone',
    region: 'Staffordshire',
    nameVariants: [],
  },
  artist: {
    sourceArtistExternalId: 'artist-1',
    sourceName: 'Test Artist',
    canonicalName: 'Test Artist',
    region: 'Staffordshire UK',
  },
  rawRowRef: 'row:1',
  confidence: 0.9,
  parseWarnings: [],
  ...overrides,
});

describe('diffEvents', () => {
  describe('basic categories', () => {
    it('should identify added events', () => {
      const previous: NormalisedEvent[] = [];
      const current: NormalisedEvent[] = [createEvent({ externalId: 'new-event' })];

      const result = diffEvents(previous, current, '2026-06-14');

      expect(result.added.length).toBe(1);
      expect(result.added[0].externalId).toBe('new-event');
      expect(result.cancelledCandidates.length).toBe(0);
      expect(result.unchanged.length).toBe(0);
      expect(result.pastDropped.length).toBe(0);
    });

    it('should identify unchanged events', () => {
      const event = createEvent({ externalId: 'same-event' });
      const previous = [event];
      const current = [{ ...event }]; // Same event

      const result = diffEvents(previous, current, '2026-06-14');

      expect(result.unchanged.length).toBe(1);
      expect(result.unchanged[0].externalId).toBe('same-event');
      expect(result.added.length).toBe(0);
      expect(result.cancelledCandidates.length).toBe(0);
      expect(result.pastDropped.length).toBe(0);
    });

    it('should identify cancelled candidates (future events missing)', () => {
      const futureEvent = createEvent({
        externalId: 'future-event',
        date: '2026-06-20', // After run date
      });
      const previous = [futureEvent];
      const current: NormalisedEvent[] = [];

      const result = diffEvents(previous, current, '2026-06-14');

      expect(result.cancelledCandidates.length).toBe(1);
      expect(result.cancelledCandidates[0].externalId).toBe('future-event');
      expect(result.pastDropped.length).toBe(0);
    });

    it('should identify past dropped events (past events missing)', () => {
      const pastEvent = createEvent({
        externalId: 'past-event',
        date: '2026-06-10', // Before run date
      });
      const previous = [pastEvent];
      const current: NormalisedEvent[] = [];

      const result = diffEvents(previous, current, '2026-06-14');

      expect(result.pastDropped.length).toBe(1);
      expect(result.pastDropped[0].externalId).toBe('past-event');
      expect(result.cancelledCandidates.length).toBe(0);
    });

    it('should handle run date boundary correctly', () => {
      const runDateEvent = createEvent({
        externalId: 'run-date-event',
        date: '2026-06-14', // Same as run date
      });
      const previous = [runDateEvent];
      const current: NormalisedEvent[] = [];

      const result = diffEvents(previous, current, '2026-06-14');

      // Events on run date are considered "past" (already happened today)
      expect(result.pastDropped.length).toBe(1);
      expect(result.cancelledCandidates.length).toBe(0);
    });
  });

  describe('complex scenarios', () => {
    it('should handle mixed categories', () => {
      const previous = [
        createEvent({ externalId: 'unchanged-1', date: '2026-06-20' }),
        createEvent({ externalId: 'cancelled-1', date: '2026-06-25' }),
        createEvent({ externalId: 'past-1', date: '2026-06-10' }),
      ];
      const current = [
        createEvent({ externalId: 'unchanged-1', date: '2026-06-20' }),
        createEvent({ externalId: 'added-1', date: '2026-06-22' }),
      ];

      const result = diffEvents(previous, current, '2026-06-14');

      expect(result.added.length).toBe(1);
      expect(result.unchanged.length).toBe(1);
      expect(result.cancelledCandidates.length).toBe(1);
      expect(result.pastDropped.length).toBe(1);
    });

    it('should match golden counts for 06-14 diff', () => {
      // From golden-counts.json: added 3, cancelledCandidates 2, pastDropped 33, unchanged 341
      // Total previous: 341 + 2 + 33 = 376 (close to 378, minus 2 dups)
      // Total current: 341 + 3 = 344

      // Create mock events matching these counts
      const unchanged = Array.from({ length: 341 }, (_, i) =>
        createEvent({ externalId: `event-${i}`, date: '2026-06-20' })
      );
      const cancelled = Array.from({ length: 2 }, (_, i) =>
        createEvent({ externalId: `cancelled-${i}`, date: '2026-06-20' })
      );
      const pastDropped = Array.from({ length: 33 }, (_, i) =>
        createEvent({ externalId: `past-${i}`, date: '2026-06-13' })
      );
      const added = Array.from({ length: 3 }, (_, i) =>
        createEvent({ externalId: `new-${i}`, date: '2026-06-21' })
      );

      const previous = [...unchanged, ...cancelled, ...pastDropped];
      const current = [...unchanged, ...added];

      const result = diffEvents(previous, current, '2026-06-14');

      expect(result.added.length).toBe(3);
      expect(result.cancelledCandidates.length).toBe(2);
      expect(result.pastDropped.length).toBe(33);
      expect(result.unchanged.length).toBe(341);
    });
  });

  describe('edge cases', () => {
    it('should handle empty previous (first run)', () => {
      const current = [createEvent()];

      const result = diffEvents([], current, '2026-06-14');

      expect(result.added.length).toBe(1);
      expect(result.unchanged.length).toBe(0);
      expect(result.cancelledCandidates.length).toBe(0);
      expect(result.pastDropped.length).toBe(0);
    });

    it('should handle empty current (all dropped)', () => {
      const previous = [
        createEvent({ externalId: 'e1', date: '2026-06-20' }),
        createEvent({ externalId: 'e2', date: '2026-06-10' }),
      ];

      const result = diffEvents(previous, [], '2026-06-14');

      expect(result.added.length).toBe(0);
      expect(result.unchanged.length).toBe(0);
      expect(result.cancelledCandidates.length).toBe(1);
      expect(result.pastDropped.length).toBe(1);
    });

    it('should handle duplicate external IDs in current (keep first)', () => {
      const event1 = createEvent({ externalId: 'dup' });
      const event2 = createEvent({ externalId: 'dup', date: '2026-06-21' });

      const result = diffEvents([], [event1, event2], '2026-06-14');

      // Should dedupe - only count as one added
      expect(result.added.length).toBe(1);
    });
  });

  describe('snapshotSemantics', () => {
    it('should emit cancelledCandidates for complete snapshots (default)', () => {
      const previous = [createEvent({ externalId: 'gone', date: '2026-06-20' })];
      const current: NormalisedEvent[] = [];

      const result = diffEvents(previous, current, '2026-06-14', 'complete');

      expect(result.cancelledCandidates.length).toBe(1);
      expect(result.absencesForReview.length).toBe(0);
    });

    it('should never emit cancelledCandidates for one_shot sources', () => {
      const previous = [
        createEvent({ externalId: 'future', date: '2026-06-20' }),
        createEvent({ externalId: 'past', date: '2026-06-10' }),
      ];
      const current: NormalisedEvent[] = [];

      const result = diffEvents(previous, current, '2026-06-14', 'one_shot');

      // one_shot sources never infer cancellations
      expect(result.cancelledCandidates.length).toBe(0);
      expect(result.pastDropped.length).toBe(0);
      expect(result.absencesForReview.length).toBe(0);
    });

    it('should route absences to review for incremental sources', () => {
      const previous = [
        createEvent({ externalId: 'future', date: '2026-06-20' }),
        createEvent({ externalId: 'past', date: '2026-06-10' }),
      ];
      const current: NormalisedEvent[] = [];

      const result = diffEvents(previous, current, '2026-06-14', 'incremental');

      // incremental sources don't auto-cancel; route to review
      expect(result.cancelledCandidates.length).toBe(0);
      expect(result.pastDropped.length).toBe(0);
      expect(result.absencesForReview.length).toBe(2);
    });

    it('should still identify added events regardless of semantics', () => {
      const current = [createEvent({ externalId: 'new' })];

      const resultComplete = diffEvents([], current, '2026-06-14', 'complete');
      const resultOneShot = diffEvents([], current, '2026-06-14', 'one_shot');
      const resultIncremental = diffEvents([], current, '2026-06-14', 'incremental');

      expect(resultComplete.added.length).toBe(1);
      expect(resultOneShot.added.length).toBe(1);
      expect(resultIncremental.added.length).toBe(1);
    });
  });
});
