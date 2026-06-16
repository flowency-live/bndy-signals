/**
 * KLMA Fetch Tests
 *
 * Tests for fetching KLMA data from Google Sheets.
 * Covers preferred URL, fallback URL, and gviz realignment.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { fetchKlmaSource, buildExportUrl, buildGvizUrl, realignGvizCsv } from './fetch';
import { klmaStokeConfig } from './config';
import { SourceRun } from '../../types';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const createMockRun = (): SourceRun => ({
  sourceId: 'klma-stoke-gig-list',
  runId: 'run_test123',
  runDate: '2026-06-13',
  startedAt: '2026-06-13T09:00:00Z',
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

describe('KLMA Fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildExportUrl', () => {
    it('should build preferred export_csv URL', () => {
      const url = buildExportUrl(klmaStokeConfig.input);

      expect(url).toBe(
        'https://docs.google.com/spreadsheets/d/1atEqyN-RI1smTzSaCtMUSui7oNp2dhCpiGoAfY5ySno/export?format=csv&gid=831966245'
      );
    });
  });

  describe('buildGvizUrl', () => {
    it('should build gviz fallback URL', () => {
      const url = buildGvizUrl(klmaStokeConfig.input);

      expect(url).toBe(
        'https://docs.google.com/spreadsheets/d/1atEqyN-RI1smTzSaCtMUSui7oNp2dhCpiGoAfY5ySno/gviz/tq?tqx=out:csv&gid=831966245'
      );
    });
  });

  describe('realignGvizCsv', () => {
    it('should drop leading column and keep 6 columns', () => {
      // gviz format has 13 columns: leading serial, date, artist, venue, time, genre, url, ...empty
      const gvizRow = '"46184.4121","Saturday, June 13, 2026","Afterglow ","The Express, Crewe ","9pm","Rock/pop","https://facebook.com/example","","","","","",""';
      const gvizData = gvizRow;

      const realigned = realignGvizCsv(gvizData, klmaStokeConfig.input.gvizRealignment!);

      // Should have: date, artist, venue, time, genre, url (6 columns)
      expect(realigned).toBe('"Saturday, June 13, 2026","Afterglow ","The Express, Crewe ","9pm","Rock/pop","https://facebook.com/example"');
    });

    it('should handle rows with empty leading column', () => {
      const gvizRow = '"","Saturday, June 13, 2026","Adam Forman","The Cock Inn Leek","8.30pm","",""';
      const realigned = realignGvizCsv(gvizRow, klmaStokeConfig.input.gvizRealignment!);

      expect(realigned).toBe('"Saturday, June 13, 2026","Adam Forman","The Cock Inn Leek","8.30pm","",""');
    });

    it('should handle multiple rows', () => {
      const gvizData = [
        '"","1/1/0125","Header Row","","","",""',
        '"46184","Saturday, June 13, 2026","Artist","Venue","9pm","Genre","http://example.com"',
      ].join('\n');

      const realigned = realignGvizCsv(gvizData, klmaStokeConfig.input.gvizRealignment!);

      const lines = realigned.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('"1/1/0125","Header Row","","","",""');
      expect(lines[1]).toBe('"Saturday, June 13, 2026","Artist","Venue","9pm","Genre","http://example.com"');
    });

    it('should preserve quoted fields with commas', () => {
      const gvizRow = '"46184","Saturday, June 13, 2026","Artist Name","Venue, City ","9pm","Rock, Pop","http://example.com"';
      const realigned = realignGvizCsv(gvizRow, klmaStokeConfig.input.gvizRealignment!);

      expect(realigned).toBe('"Saturday, June 13, 2026","Artist Name","Venue, City ","9pm","Rock, Pop","http://example.com"');
    });
  });

  describe('fetchKlmaSource', () => {
    it('should use preferred URL when successful', async () => {
      const csvContent = 'date,artist,venue,time,genre,url\nrow1,data,here,9pm,rock,http://example.com';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => csvContent,
      });

      const result = await fetchKlmaSource(klmaStokeConfig, createMockRun());

      expect(result.kind).toBe('csv');
      expect(result.body).toBe(csvContent);
      expect(result.fetchMethod).toBe('export_csv');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/export?format=csv')
      );
    });

    it('should fall back to gviz when preferred fails', async () => {
      const gvizContent = '"","1/5/2026","Artist","Venue","9pm","Genre","http://example.com"';
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403 }) // preferred fails
        .mockResolvedValueOnce({
          ok: true,
          text: async () => gvizContent,
        });

      const result = await fetchKlmaSource(klmaStokeConfig, createMockRun());

      expect(result.kind).toBe('csv');
      expect(result.fetchMethod).toBe('gviz_csv');
      // Should have realigned the gviz data
      expect(result.body).toBe('"1/5/2026","Artist","Venue","9pm","Genre","http://example.com"');
      expect(result.originalBody).toBe(gvizContent);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw when both URLs fail', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403 })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(fetchKlmaSource(klmaStokeConfig, createMockRun())).rejects.toThrow(
        /Failed to fetch/
      );
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchKlmaSource(klmaStokeConfig, createMockRun())).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      });

      const result = await fetchKlmaSource(klmaStokeConfig, createMockRun());

      expect(result.body).toBe('');
    });
  });
});
