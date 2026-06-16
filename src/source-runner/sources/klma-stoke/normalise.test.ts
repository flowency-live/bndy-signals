/**
 * KLMA Normalise Tests
 *
 * Tests for normalising raw rows into NormalisedEvent objects.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseKlmaRow,
  generateExternalId,
  NormaliseResult,
} from './normalise';
import { KlmaRawRow } from './parse';
import { klmaStokeConfig } from './config';

const createRow = (overrides: Partial<KlmaRawRow> = {}): KlmaRawRow => ({
  rowIndex: 1,
  date: 'Saturday, June 13, 2026',
  artist: 'Test Artist',
  venue: 'Test Venue',
  time: '9pm',
  genre: 'Rock',
  url: 'http://example.com',
  ...overrides,
});

describe('KLMA Normalise', () => {
  describe('generateExternalId', () => {
    it('should generate deterministic external ID', () => {
      const id1 = generateExternalId('2026-06-13', 'The Swan', 'Test Artist');
      const id2 = generateExternalId('2026-06-13', 'The Swan', 'Test Artist');

      expect(id1).toBe(id2);
    });

    it('should include source prefix', () => {
      const id = generateExternalId('2026-06-13', 'The Swan', 'Test Artist');

      expect(id).toMatch(/^klma-/);
    });

    it('should differ for different inputs', () => {
      const id1 = generateExternalId('2026-06-13', 'The Swan', 'Artist A');
      const id2 = generateExternalId('2026-06-13', 'The Swan', 'Artist B');

      expect(id1).not.toBe(id2);
    });

    it('should canonicalise venue before hashing', () => {
      // Different whitespace/formatting should produce same ID
      const id1 = generateExternalId('2026-06-13', 'The Swan Stone', 'Artist');
      const id2 = generateExternalId('2026-06-13', '  The Swan Stone  ', 'Artist');

      expect(id1).toBe(id2);
    });

    it('should normalise artist before hashing (whitespace, case)', () => {
      // Different whitespace/casing should produce same ID
      const id1 = generateExternalId('2026-06-13', 'The Swan', 'Test Artist');
      const id2 = generateExternalId('2026-06-13', 'The Swan', '  Test Artist  ');
      const id3 = generateExternalId('2026-06-13', 'The Swan', 'TEST ARTIST');
      const id4 = generateExternalId('2026-06-13', 'The Swan', 'test artist');

      expect(id1).toBe(id2);
      expect(id1).toBe(id3);
      expect(id1).toBe(id4);
    });
  });

  describe('normaliseKlmaRow', () => {
    it('should normalise a valid row', () => {
      const row = createRow();
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event).toBeDefined();
      expect(result.event!.date).toBe('2026-06-13');
      expect(result.event!.startTime).toBe('21:00');
      expect(result.event!.venue.sourceName).toBe('Test Venue');
      expect(result.event!.artist.sourceName).toBe('Test Artist');
    });

    it('should parse long-form dates', () => {
      const row = createRow({ date: 'Saturday, June 13, 2026' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.date).toBe('2026-06-13');
    });

    it('should parse time and set provenance', () => {
      const row = createRow({ time: '9pm' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.startTime).toBe('21:00');
      expect(result.event!.timeProvenance).toBe('parsed');
    });

    it('should use default time when missing', () => {
      const row = createRow({ time: '' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.startTime).toBe('21:00'); // config default
      expect(result.event!.timeProvenance).toBe('defaulted_from_missing');
    });

    it('should detect Cheshire region from venue', () => {
      const row = createRow({ venue: 'The Express, Crewe' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.venue.region).toBe('Cheshire');
      expect(result.event!.venue.city).toBe('Crewe');
    });

    it('should default to Staffordshire region', () => {
      const row = createRow({ venue: 'The Swan, Stone' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.venue.region).toBe('Staffordshire');
    });

    it('should canonicalise venue name', () => {
      // Use a venue that's NOT in the alias table
      const row = createRow({ venue: '  The Red Lion Leek  ' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.venue.canonicalName).toBe('The Red Lion Leek');
    });

    it('should lookup venue alias', () => {
      const row = createRow({ venue: "The Nag's Head Macclesfield" });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.venue.canonicalName).toBe('The Nags Head, Macclesfield');
    });

    it('should park specialist venue rows', () => {
      const row = createRow({ venue: 'Artisan Tap, Hartshill' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(false);
      expect(result.parkReason).toBe('specialist_venue');
    });

    it('should park multi-act venue rows', () => {
      const row = createRow({ venue: 'The Rigger, Newcastle-under-Lyme' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(false);
      expect(result.parkReason).toBe('multi_act');
    });

    it('should include parse warnings', () => {
      const row = createRow({ time: '7:12 AM' }); // corrupt time
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.parseWarnings.length).toBeGreaterThan(0);
    });

    it('should include event URL', () => {
      const row = createRow({ url: 'http://example.com/event' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.eventUrl).toBe('http://example.com/event');
    });

    it('should include raw row reference', () => {
      const row = createRow({ rowIndex: 42 });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(true);
      expect(result.event!.rawRowRef).toBe('row:42');
    });

    it('should park rows with empty artist', () => {
      const row = createRow({ artist: '' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(false);
      expect(result.parkReason).toBe('non_artist_event');
    });

    it('should park rows with whitespace-only artist', () => {
      const row = createRow({ artist: '   ' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(false);
      expect(result.parkReason).toBe('non_artist_event');
    });

    it('should park rows with empty venue', () => {
      const row = createRow({ venue: '' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(false);
      expect(result.parkReason).toBe('non_artist_event');
    });

    it('should park rows with whitespace-only venue', () => {
      const row = createRow({ venue: '   ' });
      const result = normaliseKlmaRow(row, klmaStokeConfig);

      expect(result.success).toBe(false);
      expect(result.parkReason).toBe('non_artist_event');
    });
  });
});
