/**
 * gigs-news Source Configuration
 *
 * Stockport/Tameside/east Cheshire gig listings at gigs-news.uk.
 * JS-rendered site requiring Puppeteer fetch.
 *
 * From the handoff doc (gigs-news-source-handoff.md):
 * - URL: https://gigs-news.uk (NOT .co.uk)
 * - Region: Stockport/Tameside/east Cheshire/Saddleworth/High Peak fringe
 * - JS-rendered - requires headless browser
 * - Weekly guide format with day groupings
 * - Cadence: Weekly content, most runs = "no changes"
 */

import { SourceConfig } from '../../types';

export const gigsNewsConfig: SourceConfig = {
  id: 'gigs-news-daily-import',
  name: 'gigs-news',
  type: 'aggregator',
  region: 'Greater Manchester / East Cheshire',
  defaultCity: 'Stockport',
  defaultArtistLocation: 'Greater Manchester UK',
  timezone: 'Europe/London',

  schedule: {
    cadence: 'daily',
    localTime: '09:00', // Match handoff doc timing
  },

  input: {
    kind: 'js_rendered_page',
    url: 'https://gigs-news.uk',
  },

  eventPolicy: {
    createPublicEvents: true,
    missingTimeDefault: '20:00', // Handoff doc: default 20:00 when not given
    deleteFutureMissingRows: true,
    neverDeletePastEvents: true,
    duplicateEventBehaviour: 'attach_external_id_no_clobber',
  },

  parkingLot: {
    specialistVenueSlugs: [],
    multiActVenueSlugs: [],
    reasons: [
      'placeholder_performer',
      'jam_night',
      'generic_recurring',
      'generic_dj',
      'venue_only',
      'venue_geocode_risk',
      'unparseable',
    ],
  },

  // ADR-021 rev.3: Footprint scoring handles artist disambiguation
  // ADR-018: Venue place_id geocode find-or-create
  thresholds: {
    venueAutoMatch: 0.95,
    artistAutoMatch: 0.9,
    eventAutoCreate: 0.95,
    socialAutoAttach: 0.95,
  },

  snapshotSemantics: 'complete', // Full page = can infer cancellations
};
