/**
 * KLMA Stoke Gig List Source Configuration
 *
 * Community-maintained Google Sheet of local gigs in Staffordshire and surrounding areas.
 * This is the first source for the bndy source runner MVP.
 *
 * Key characteristics:
 * - Google Sheets CSV export with gviz fallback
 * - Daily processing schedule
 * - Spans Staffordshire + Cheshire regions (25 distinct Cheshire venues)
 * - Contains specialist venues (Artisan Tap, Eleven) and multi-act venues (The Rigger)
 * - Time parsing is highly polymorphic (28 distinct patterns)
 * - Venue strings have significant variation (3-4 variants per venue)
 */

import { SourceConfig } from '../../types';

export const klmaStokeConfig: SourceConfig = {
  id: 'klma-stoke-gig-list',
  name: 'KLMA Stoke Gig List',
  type: 'community_sheet',
  region: 'Staffordshire',
  defaultCity: 'Stoke-on-Trent',
  defaultArtistLocation: 'Staffordshire UK',
  timezone: 'Europe/London',

  schedule: {
    cadence: 'daily',
    localTime: '09:00',
  },

  input: {
    kind: 'google_sheet_csv',
    sheetId: '1atEqyN-RI1smTzSaCtMUSui7oNp2dhCpiGoAfY5ySno',
    gid: '831966245',
    preferredExport: 'export_csv',
    fallbackExport: 'gviz_csv',
    // gviz returns 13 columns; drop leading column BY POSITION (Google serial),
    // keep next 6: date, artist, venue, time, genre, url
    gvizRealignment: {
      dropLeadingColumn: true,
      keepColumns: 6,
    },
  },

  eventPolicy: {
    createPublicEvents: true,
    missingTimeDefault: '21:00',
    deleteFutureMissingRows: true,
    neverDeletePastEvents: true,
    duplicateEventBehaviour: 'attach_external_id_no_clobber',
  },

  parkingLot: {
    // Specialist venues: ticketed/curated, not simple gig rows
    specialistVenueSlugs: ['artisan-tap', 'eleven'],
    // Multi-act venues: park unless lineup cleanly resolves
    multiActVenueSlugs: ['the-rigger-newcastle-under-lyme'],
    reasons: [
      'specialist_venue',
      'multi_act',
      'non_artist_event',
      'form_metadata',
      'time_unconfirmed',
      'unparseable',
      'low_confidence_match',
      'date_sentinel',
      'cheshire_unknown_town',
    ],
  },

  // Note: These thresholds are from the spec but the handoff pack shows they
  // are miscalibrated for real data. The resolution ladder should prioritize
  // external-id/state lookup over name confidence scoring.
  // See resolution/entity-resolution-seed.json for real-world evidence.
  thresholds: {
    venueAutoMatch: 0.95,
    artistAutoMatch: 0.9,
    eventAutoCreate: 0.95,
    socialAutoAttach: 0.95,
  },

  // KLMA is a complete snapshot - the full CSV represents all current events
  // This means missing events can be inferred as cancellations
  snapshotSemantics: 'complete',

  // Region override: KLMA spans Staffordshire + Cheshire
  // 25 distinct Cheshire venues observed in 2026-06-13 data
  // CRITICAL: Never default to Stoke for out-of-region venues
  regionOverride: {
    defaultRegion: 'Staffordshire',
    defaultCity: 'Stoke-on-Trent',
    // Map of town names to their correct region
    // If venue string contains one of these towns, use that region
    overrideTowns: {
      Crewe: 'Cheshire',
      Macclesfield: 'Cheshire',
      Haslington: 'Cheshire',
      Sandbach: 'Cheshire',
      Congleton: 'Cheshire',
      Nantwich: 'Cheshire',
      Alsager: 'Cheshire',
      Wilmslow: 'Cheshire',
      Knutsford: 'Cheshire',
    },
  },
};
