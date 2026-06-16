/**
 * Golden Assertion Test for KLMA Parser
 *
 * Semantic regression test against the 2026-06-13 fixture.
 * Per golden/README.md guidance:
 * - Assert counts (events=378, distinct venues≈185, distinct artists≈158)
 * - Do NOT deep-equal park-reason buckets (categorisation differs by design)
 * - Do NOT assert per-event city (golden has old defaults; fixed detectRegion is better)
 * - Assert region on known-good cases
 * - Spot-check canonical name resolution
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseKlmaRows } from './parse';
import { normaliseKlmaRow, NormaliseResult } from './normalise';
import { klmaStokeConfig } from './config';

const FIXTURES_PATH = join(__dirname, '../../../../test/fixtures/klma-stoke');

describe('KLMA Golden Assertion (2026-06-13)', () => {
  // Load and parse the fixture once
  const csvData = readFileSync(join(FIXTURES_PATH, 'source-2026-06-13.csv'), 'utf-8');
  const parsed = parseKlmaRows(csvData);

  // Normalise all event rows
  const normaliseResults: NormaliseResult[] = parsed.eventRows.map((row) =>
    normaliseKlmaRow(row, klmaStokeConfig)
  );
  const events = normaliseResults.filter((r) => r.success).map((r) => r.event!);
  const parked = normaliseResults.filter((r) => !r.success);

  describe('Parse counts', () => {
    it('should parse 500 raw rows', () => {
      expect(parsed.rawRowCount).toBe(500);
    });

    it('should identify metadata rows at parse stage', () => {
      expect(parsed.metadataRows.length).toBe(19);
    });

    it('should produce 480 candidate event rows', () => {
      expect(parsed.eventRows.length).toBe(480);
    });
  });

  describe('Normalise counts (golden targets)', () => {
    it('should produce 378 events', () => {
      expect(events.length).toBe(378);
    });

    it('should park approximately 102 rows', () => {
      // Park reasons differ by design; assert total count is close
      // 70 specialist + 24 multi-act + 8 empty = 102
      expect(parked.length).toBeGreaterThanOrEqual(100);
      expect(parked.length).toBeLessThanOrEqual(105);
    });

    it('should park 70 specialist venue rows', () => {
      const specialist = parked.filter((r) => r.parkReason === 'specialist_venue');
      expect(specialist.length).toBe(70);
    });

    it('should park 24 multi-act venue rows', () => {
      const multiAct = parked.filter((r) => r.parkReason === 'multi_act');
      expect(multiAct.length).toBe(24);
    });

    it('should park empty rows as non_artist_event', () => {
      const nonArtist = parked.filter((r) => r.parkReason === 'non_artist_event');
      // Golden calls these form_metadata; we call them non_artist_event
      expect(nonArtist.length).toBe(8);
    });
  });

  describe('Distinct entity counts', () => {
    it('should have approximately 185 distinct venues', () => {
      const distinctVenues = new Set(events.map((e) => e.venue.canonicalName));
      // Allow variance - golden used more canonicalisation; we're slightly higher
      expect(distinctVenues.size).toBeGreaterThanOrEqual(150);
      expect(distinctVenues.size).toBeLessThanOrEqual(210);
    });

    it('should have approximately 158 distinct artists', () => {
      const distinctArtists = new Set(events.map((e) => e.artist.canonicalName));
      // Allow some variance due to canonicalisation differences
      expect(distinctArtists.size).toBeGreaterThanOrEqual(130);
      expect(distinctArtists.size).toBeLessThanOrEqual(180);
    });
  });

  describe('Region detection (spot checks)', () => {
    it('should assign Cheshire region to Crewe venues', () => {
      const creweEvents = events.filter((e) =>
        e.venue.sourceName.toLowerCase().includes('crewe')
      );
      expect(creweEvents.length).toBeGreaterThan(0);
      for (const event of creweEvents) {
        expect(event.venue.region).toBe('Cheshire');
      }
    });

    it('should assign Cheshire region to Audlem venues', () => {
      const audlemEvents = events.filter((e) =>
        e.venue.sourceName.toLowerCase().includes('audlem')
      );
      expect(audlemEvents.length).toBeGreaterThan(0);
      for (const event of audlemEvents) {
        expect(event.venue.region).toBe('Cheshire');
      }
    });

    it('should assign Staffordshire region to Leek venues', () => {
      const leekEvents = events.filter((e) =>
        e.venue.sourceName.toLowerCase().includes('leek')
      );
      expect(leekEvents.length).toBeGreaterThan(0);
      for (const event of leekEvents) {
        expect(event.venue.region).toBe('Staffordshire');
      }
    });

    it('should assign Staffordshire region to Stone venues', () => {
      const stoneEvents = events.filter((e) =>
        e.venue.sourceName.toLowerCase().includes('stone')
      );
      expect(stoneEvents.length).toBeGreaterThan(0);
      for (const event of stoneEvents) {
        expect(event.venue.region).toBe('Staffordshire');
      }
    });
  });

  describe('Canonical name resolution (spot checks)', () => {
    it('should resolve Cosey variants to canonical name', () => {
      const coseyEvents = events.filter((e) =>
        e.venue.sourceName.toLowerCase().includes('cosey')
      );
      expect(coseyEvents.length).toBeGreaterThan(0);
      for (const event of coseyEvents) {
        expect(event.venue.canonicalName).toBe('The Cosey, Haslington');
      }
    });

    it('should resolve Swiftys variants to single canonical name', () => {
      const swiftysEvents = events.filter((e) =>
        e.venue.sourceName.toLowerCase().includes('swift')
      );
      expect(swiftysEvents.length).toBeGreaterThan(0);
      // Per golden guidance: check all variants resolve to ONE canonical, not specific string
      const canonicalNames = new Set(swiftysEvents.map((e) => e.venue.canonicalName));
      expect(canonicalNames.size).toBe(1);
    });
  });

  describe('No empty field leakage', () => {
    it('should not have any events with empty artist', () => {
      const emptyArtist = events.filter((e) => !e.artist.sourceName.trim());
      expect(emptyArtist.length).toBe(0);
    });

    it('should not have any events with empty venue', () => {
      const emptyVenue = events.filter((e) => !e.venue.sourceName.trim());
      expect(emptyVenue.length).toBe(0);
    });
  });
});
