/**
 * KLMA Source Adapter
 *
 * Implements the SourceAdapter interface for the KLMA Stoke gig list.
 * Bundles fetch + parse + normalise into a single adapter.
 */

import { SourceAdapter, registerSourceAdapter } from '../../adapter/SourceAdapter';
import { SourceConfig, SourceRun, ParkingLotItem, ParkingLotReason } from '../../types';
import { FetchedSource, ParsedSource } from '../../runner';
import { fetchKlmaSource } from './fetch';
import { parseKlmaRows, KlmaRawRow } from './parse';
import { normaliseKlmaRow } from './normalise';

/**
 * KLMA source adapter implementation.
 */
export const klmaStokeAdapter: SourceAdapter = {
  /**
   * Fetch KLMA data from Google Sheets.
   */
  async fetch(config: SourceConfig, run: SourceRun): Promise<FetchedSource> {
    return fetchKlmaSource(config, run);
  },

  /**
   * Parse and normalise KLMA CSV data.
   * Combines parsing (CSV → raw rows) and normalisation (raw → normalised events).
   */
  async parse(
    config: SourceConfig,
    run: SourceRun,
    raw: FetchedSource
  ): Promise<ParsedSource> {
    // Parse CSV into categorised rows
    const parsed = parseKlmaRows(raw.body);

    // Normalise event rows
    const events = [];
    const parked: ParkingLotItem[] = [];

    for (const row of parsed.eventRows) {
      const result = normaliseKlmaRow(row, config);

      if (result.success && result.event) {
        events.push(result.event);
      } else if (result.parkReason) {
        parked.push(createParkingLotItem(row, result.parkReason, config.id, run.runId));
      }
    }

    // Park metadata rows
    for (const row of parsed.metadataRows) {
      parked.push(createParkingLotItem(row, 'form_metadata', config.id, run.runId));
    }

    // Park sentinel rows
    for (const row of parsed.sentinelRows) {
      parked.push(createParkingLotItem(row, 'date_sentinel', config.id, run.runId));
    }

    // Park unparseable date rows
    for (const row of parsed.unparseableDateRows) {
      parked.push(createParkingLotItem(row, 'unparseable', config.id, run.runId));
    }

    return { events, parked };
  },
};

/**
 * Create a parking lot item from a raw row.
 */
function createParkingLotItem(
  row: KlmaRawRow,
  reason: ParkingLotReason,
  sourceId: string,
  runId: string
): ParkingLotItem {
  return {
    reason,
    sourceId,
    runId,
    rawRow: {
      rowIndex: row.rowIndex,
      date: row.date,
      artist: row.artist,
      venue: row.venue,
      time: row.time,
      genre: row.genre,
      url: row.url,
    },
    createdAt: new Date().toISOString(),
  };
}

// Register the adapter
registerSourceAdapter('klma-stoke-gig-list', klmaStokeAdapter);
