/**
 * KLMA Parse Tests
 *
 * Tests for parsing KLMA CSV data into raw rows.
 */

import { describe, it, expect } from 'vitest';
import { parseCsv, parseKlmaRows, KlmaRawRow } from './parse';
import * as fs from 'fs';
import * as path from 'path';

// Load test fixtures
const fixturesDir = path.join(__dirname, '../../../../test/fixtures/klma-stoke');
const csvFixture = fs.readFileSync(path.join(fixturesDir, 'source-2026-06-13.csv'), 'utf-8');
const expectedCounts = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, 'parse-counts.json'), 'utf-8')
);

describe('KLMA Parse', () => {
  describe('parseCsv', () => {
    it('should parse CSV with header row', () => {
      const csv = 'date,artist,venue,time,genre,url\n"Saturday, June 13, 2026",Artist,Venue,9pm,Rock,http://example.com';

      const rows = parseCsv(csv);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        date: 'Saturday, June 13, 2026',
        artist: 'Artist',
        venue: 'Venue',
        time: '9pm',
        genre: 'Rock',
        url: 'http://example.com',
      });
    });

    it('should handle quoted fields with commas', () => {
      const csv = 'date,artist,venue,time,genre,url\n"Saturday, June 13, 2026","Artist Name","Venue, City",9pm,"Rock, Pop",http://example.com';

      const rows = parseCsv(csv);

      expect(rows[0].venue).toBe('Venue, City');
      expect(rows[0].genre).toBe('Rock, Pop');
    });

    it('should handle escaped quotes in fields', () => {
      const csv = 'date,artist,venue,time,genre,url\n"Saturday, June 13, 2026","Artist ""Nickname"" Name",Venue,9pm,,';

      const rows = parseCsv(csv);

      expect(rows[0].artist).toBe('Artist "Nickname" Name');
    });

    it('should handle empty fields', () => {
      const csv = 'date,artist,venue,time,genre,url\n"Saturday, June 13, 2026",Artist,Venue,,,';

      const rows = parseCsv(csv);

      expect(rows[0].time).toBe('');
      expect(rows[0].genre).toBe('');
      expect(rows[0].url).toBe('');
    });

    it('should handle multiple rows', () => {
      const csv = [
        'date,artist,venue,time,genre,url',
        '"Saturday, June 13, 2026",Artist1,Venue1,9pm,,',
        '"Sunday, June 14, 2026",Artist2,Venue2,10pm,,',
      ].join('\n');

      const rows = parseCsv(csv);

      expect(rows).toHaveLength(2);
      expect(rows[0].artist).toBe('Artist1');
      expect(rows[1].artist).toBe('Artist2');
    });

    it('should skip empty rows', () => {
      const csv = [
        'date,artist,venue,time,genre,url',
        '"Saturday, June 13, 2026",Artist1,Venue1,9pm,,',
        '',
        '"Sunday, June 14, 2026",Artist2,Venue2,10pm,,',
      ].join('\n');

      const rows = parseCsv(csv);

      expect(rows).toHaveLength(2);
    });

    it('should handle trailing whitespace in fields', () => {
      const csv = 'date,artist,venue,time,genre,url\n"Saturday, June 13, 2026","Artist ","Venue ",9pm,,';

      const rows = parseCsv(csv);

      // Parse preserves whitespace; normalisation handles trimming
      expect(rows[0].artist).toBe('Artist ');
      expect(rows[0].venue).toBe('Venue ');
    });
  });

  describe('parseKlmaRows', () => {
    it('should identify metadata rows', () => {
      const csv = [
        'date,artist,venue,time,genre,url',
        '1/1/0125,Keep Live Music Alive In Stoke On Trent And Surrounding Areas,,,https://www.facebook.com/groups/111164642295828,',
        '1/4/0202,,,,,',
        '1/5/2026,You Can Add Your Own Gigs By Clicking On \'Gig List Form\' >>,,Gig List Form,,',
        '"Saturday, June 13, 2026",Artist,Venue,9pm,,',
      ].join('\n');

      const result = parseKlmaRows(csv);

      expect(result.metadataRows).toHaveLength(3);
      expect(result.eventRows).toHaveLength(1);
    });

    it('should identify sentinel dates (1899)', () => {
      const csv = [
        'date,artist,venue,time,genre,url',
        '"Saturday, December 30, 1899",Artist,Venue,9pm,,',
        '"Saturday, June 13, 2026",Artist,Venue,9pm,,',
      ].join('\n');

      const result = parseKlmaRows(csv);

      expect(result.sentinelRows).toHaveLength(1);
      expect(result.eventRows).toHaveLength(1);
    });

    it('should return correct counts from real fixture', () => {
      const result = parseKlmaRows(csvFixture);

      // Verify against expected counts from handoff pack
      expect(result.rawRowCount).toBe(expectedCounts.raw_rows);
      expect(result.metadataRows.length).toBe(expectedCounts.metadata_rows);
      expect(result.eventRows.length).toBe(expectedCounts.valid_event_rows);
    });

    it('should preserve row index for traceability', () => {
      const csv = [
        'date,artist,venue,time,genre,url',
        '1/1/0125,Metadata,,,',
        '"Saturday, June 13, 2026",Artist,Venue,9pm,,',
      ].join('\n');

      const result = parseKlmaRows(csv);

      // Row indices should be 1-based (after header)
      expect(result.metadataRows[0].rowIndex).toBe(1);
      expect(result.eventRows[0].rowIndex).toBe(2);
    });
  });

  describe('KlmaRawRow', () => {
    it('should have all required fields', () => {
      const row: KlmaRawRow = {
        rowIndex: 1,
        date: 'Saturday, June 13, 2026',
        artist: 'Artist Name',
        venue: 'Venue Name',
        time: '9pm',
        genre: 'Rock',
        url: 'http://example.com',
      };

      expect(row.rowIndex).toBe(1);
      expect(row.date).toBe('Saturday, June 13, 2026');
    });
  });
});
