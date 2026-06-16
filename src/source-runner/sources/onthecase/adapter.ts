/**
 * On The Case Source Adapter
 *
 * Implements the SourceAdapter interface for onthecasemusic.co.uk/gigs.
 * Uses Puppeteer for JS-rendering fetch.
 */

import { SourceAdapter, registerSourceAdapter } from '../../adapter/SourceAdapter';
import { SourceConfig, SourceRun, ParkingLotItem, ParkingLotReason } from '../../types';
import { FetchedSource, ParsedSource } from '../../runner';
import { fetchOnTheCaseSource } from './fetch';
import { parseOnTheCasePage, OnTheCaseParkedGig } from './parse';
import { normaliseOnTheCaseGig } from './normalise';

/**
 * On The Case source adapter implementation.
 */
export const onTheCaseAdapter: SourceAdapter = {
  /**
   * Fetch On The Case page using Puppeteer.
   */
  async fetch(config: SourceConfig, run: SourceRun): Promise<FetchedSource> {
    return fetchOnTheCaseSource(config, run);
  },

  /**
   * Parse and normalise On The Case HTML content.
   */
  async parse(
    config: SourceConfig,
    run: SourceRun,
    raw: FetchedSource
  ): Promise<ParsedSource> {
    // Parse HTML into raw gigs
    const parsed = parseOnTheCasePage(raw.body);

    // Normalise valid gigs
    const events = parsed.gigs.map((gig) => normaliseOnTheCaseGig(gig, config));

    // Convert parked gigs to ParkingLotItem format
    const parked: ParkingLotItem[] = parsed.parked.map((p) =>
      createParkingLotItem(p, config.id, run.runId)
    );

    return { events, parked };
  },
};

/**
 * Create a parking lot item from a parked gig.
 */
function createParkingLotItem(
  parked: OnTheCaseParkedGig,
  sourceId: string,
  runId: string
): ParkingLotItem {
  return {
    reason: parked.reason as ParkingLotReason,
    sourceId,
    runId,
    rawRow: {
      date: parked.date,
      line1: parked.rawLine1,
      line2: parked.rawLine2,
      line3: parked.rawLine3,
    },
    createdAt: new Date().toISOString(),
  };
}

// Register the adapter
registerSourceAdapter('onthecase-daily-import', onTheCaseAdapter);
