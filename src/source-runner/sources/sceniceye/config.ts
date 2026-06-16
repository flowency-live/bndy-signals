/**
 * Scenic Eye Source Configuration
 *
 * Hampshire gig listings at scenicmind.co.uk/sceniceye.
 * JS-rendered site requiring Puppeteer fetch.
 *
 * From sceniceye-source-handoff.md:
 * - URL: https://scenicmind.co.uk/sceniceye (NOT sceniceye.co.uk - that's a frameset)
 * - Region: Hampshire (Hayling Island, Havant, Emsworth, Waterlooville)
 * - JS-rendered - requires headless browser
 * - Weekly edition format with Thu-Sun gigs
 * - Full street addresses + explicit times
 * - Staleness is the norm - most runs import 0
 */

import { SourceConfig } from '../../types';

export const scenicEyeConfig: SourceConfig = {
  id: 'sceniceye-daily-import',
  name: 'sceniceye',
  type: 'aggregator',
  region: 'Hampshire',
  defaultCity: 'Havant',
  defaultArtistLocation: 'Hampshire UK',
  timezone: 'Europe/London',

  schedule: {
    cadence: 'daily',
    localTime: '09:00',
  },

  input: {
    kind: 'js_rendered_page',
    // IMPORTANT: sceniceye.co.uk is a frameset - fetch the inner content directly
    url: 'https://scenicmind.co.uk/sceniceye',
  },

  eventPolicy: {
    createPublicEvents: true,
    // No missingTimeDefault - Scenic Eye always has explicit times
    deleteFutureMissingRows: true,
    neverDeletePastEvents: true,
    duplicateEventBehaviour: 'attach_external_id_no_clobber',
  },

  parkingLot: {
    specialistVenueSlugs: [],
    multiActVenueSlugs: [],
    reasons: ['unparseable'],
  },

  // ADR-021 rev.3: Footprint scoring handles artist disambiguation
  // ADR-018: Venue place_id geocode find-or-create (uses full street address)
  thresholds: {
    venueAutoMatch: 0.95,
    artistAutoMatch: 0.9,
    eventAutoCreate: 0.95,
    socialAutoAttach: 0.95,
  },

  snapshotSemantics: 'complete', // Full weekly edition = can infer cancellations
};
