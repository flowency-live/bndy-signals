/**
 * gigs-news Source Adapter
 *
 * Implements the SourceAdapter interface for gigs-news.uk.
 * Uses Puppeteer for JS-rendering fetch.
 */

import {
  SourceAdapter,
  registerSourceAdapter,
} from '../../adapter/SourceAdapter';
import {
  SourceConfig,
  SourceRun,
  ParkingLotItem,
  ParkingLotReason,
} from '../../types';
import { FetchedSource, ParsedSource } from '../../runner';
import { fetchGigsNewsSource } from './fetch';
import { parseGigsNewsPage, GigsNewsParkedGig } from './parse';
import { normaliseGigsNewsGig } from './normalise';

/**
 * gigs-news source adapter implementation.
 */
export const gigsNewsAdapter: SourceAdapter = {
  /**
   * Fetch gigs-news page using Puppeteer.
   */
  async fetch(config: SourceConfig, run: SourceRun): Promise<FetchedSource> {
    return fetchGigsNewsSource(config, run);
  },

  /**
   * Parse and normalise gigs-news HTML content.
   */
  async parse(
    config: SourceConfig,
    run: SourceRun,
    raw: FetchedSource
  ): Promise<ParsedSource> {
    // Extract year from run date
    const year = parseInt(run.runDate.slice(0, 4), 10);

    // Parse HTML into raw gigs
    const parsed = parseGigsNewsPage(raw.body, year);

    // Normalise valid gigs
    const events = parsed.gigs.map((gig) => normaliseGigsNewsGig(gig, config));

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
  parked: GigsNewsParkedGig,
  sourceId: string,
  runId: string
): ParkingLotItem {
  return {
    reason: parked.reason as ParkingLotReason,
    sourceId,
    runId,
    rawRow: {
      date: parked.date,
      line: parked.rawLine,
    },
    createdAt: new Date().toISOString(),
  };
}

// Register the adapter
registerSourceAdapter('gigs-news-daily-import', gigsNewsAdapter);
