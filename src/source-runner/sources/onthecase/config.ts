/**
 * On The Case Source Configuration
 *
 * North East England gig aggregator at onthecasemusic.co.uk/gigs.
 * JS-rendered site requiring Puppeteer fetch.
 *
 * From the handoff doc (onthecase-source-handoff.md):
 * - Region: North East England (Newcastle/Gateshead/Sunderland/Northumberland/County Durham)
 * - JS-rendered site - requires headless browser
 * - 3-line listing format: Artist at Venue, Address/Phone, Time/Price
 * - Skip rules: TBC, Open Mic, Jam nights, Private Function
 * - Steady state: ~2-3 new gigs per run, mostly events-only (artists/venues already exist)
 */

import { SourceConfig } from '../../types';

export const onTheCaseConfig: SourceConfig = {
  id: 'onthecase-daily-import',
  name: 'On The Case Music',
  type: 'aggregator',
  region: 'North East England',
  defaultCity: 'Newcastle upon Tyne',
  defaultArtistLocation: 'North East England UK',
  timezone: 'Europe/London',

  schedule: {
    cadence: 'daily',
    localTime: '04:05', // Match existing Cowork schedule
  },

  input: {
    kind: 'js_rendered_page',
    url: 'https://onthecasemusic.co.uk/gigs',
  },

  eventPolicy: {
    createPublicEvents: true,
    missingTimeDefault: '21:00',
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
      'private_function',
      'placeholder_venue',
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
