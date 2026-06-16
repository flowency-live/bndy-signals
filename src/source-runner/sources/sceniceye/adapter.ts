/**
 * Scenic Eye Source Adapter
 *
 * Implements the SourceAdapter interface for scenicmind.co.uk/sceniceye.
 * Uses Puppeteer for JS-rendering fetch.
 *
 * Key behaviour: Staleness is the norm. Most runs import 0 because the
 * weekly edition is often stale (Neil hasn't posted the new week yet).
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
import { fetchScenicEyeSource } from './fetch';
import { parseScenicEyePage, ScenicEyeParkedGig } from './parse';
import { normaliseScenicEyeGig } from './normalise';

/**
 * Scenic Eye source adapter implementation.
 */
export const scenicEyeAdapter: SourceAdapter = {
  /**
   * Fetch Scenic Eye page using Puppeteer.
   */
  async fetch(config: SourceConfig, run: SourceRun): Promise<FetchedSource> {
    return fetchScenicEyeSource(config, run);
  },

  /**
   * Parse and normalise Scenic Eye HTML content.
   *
   * If the edition is stale (all gigs are past), returns empty events array.
   * This is expected behaviour - most runs import 0.
   */
  async parse(
    config: SourceConfig,
    run: SourceRun,
    raw: FetchedSource
  ): Promise<ParsedSource> {
    // Parse HTML into raw gigs
    const parsed = parseScenicEyePage(raw.body, run.runDate);

    // If stale, log and return empty
    if (parsed.isStale) {
      console.log(
        `Scenic Eye edition is stale: ${parsed.staleReason}. Importing 0 gigs.`
      );
      return { events: [], parked: [] };
    }

    // Normalise valid gigs
    const events = parsed.gigs.map((gig) => normaliseScenicEyeGig(gig, config));

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
  parked: ScenicEyeParkedGig,
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
registerSourceAdapter('sceniceye-daily-import', scenicEyeAdapter);
