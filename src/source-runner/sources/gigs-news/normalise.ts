/**
 * gigs-news Normalise
 *
 * Converts GigsNewsRawGig to NormalisedEvent.
 * Uses venueCanonical (aliased name) for matching.
 * Region defaults to Greater Manchester / East Cheshire.
 */

import {
  NormalisedEvent,
  NormalisedVenueRef,
  NormalisedArtistRef,
  SourceConfig,
  TimeProvenance,
} from '../../types';
import { GigsNewsRawGig } from './parse';

/**
 * Slugify a string for use in external IDs.
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Strip trailing act qualifiers from artist name for ID generation.
 */
function stripActSuffix(name: string): string {
  const suffixes = [
    ' band',
    ' duo',
    ' trio',
    ' live',
    ' acoustic',
    ' show',
    ' music',
  ];
  const lower = name.toLowerCase();
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix)) {
      return name.slice(0, -suffix.length).trim();
    }
  }
  return name;
}

/**
 * Generate external ID for a gigs-news gig.
 * Format: {date}_{artist-slug}_{venue-slug}
 */
function generateExternalId(gig: GigsNewsRawGig): string {
  const artistCore = stripActSuffix(gig.artist);
  const artistSlug = slugify(artistCore);
  const venueSlug = slugify(gig.venueCanonical);
  return `${gig.date}_${artistSlug}_${venueSlug}`;
}

/**
 * Generate venue external ID.
 * Format: venue_{venue-slug}
 */
function generateVenueExternalId(gig: GigsNewsRawGig): string {
  const venueSlug = slugify(gig.venueCanonical);
  return `venue_${venueSlug}`;
}

/**
 * Generate artist external ID.
 * Format: artist_{artist-slug}
 */
function generateArtistExternalId(gig: GigsNewsRawGig): string {
  const artistCore = stripActSuffix(gig.artist);
  const artistSlug = slugify(artistCore);
  return `artist_${artistSlug}`;
}

/**
 * Normalise a gigs-news raw gig to a NormalisedEvent.
 */
export function normaliseGigsNewsGig(
  gig: GigsNewsRawGig,
  config: SourceConfig
): NormalisedEvent {
  const venue: NormalisedVenueRef = {
    sourceVenueExternalId: generateVenueExternalId(gig),
    sourceName: gig.venue,
    canonicalName: gig.venueCanonical,
    city: config.defaultCity,
    region: config.region,
    nameVariants: gig.venue !== gig.venueCanonical ? [gig.venue] : [],
  };

  const artist: NormalisedArtistRef = {
    sourceArtistExternalId: generateArtistExternalId(gig),
    sourceName: gig.artist,
    canonicalName: gig.artist,
    region: config.defaultArtistLocation,
  };

  const timeProvenance: TimeProvenance = gig.timeDefaulted
    ? 'defaulted_from_missing'
    : 'parsed';

  const parseWarnings: string[] = [];
  if (gig.timeDefaulted) {
    parseWarnings.push('Time defaulted to 20:00');
  }

  const event: NormalisedEvent = {
    sourceId: config.id,
    externalId: generateExternalId(gig),
    date: gig.date,
    startTime: gig.time,
    timeProvenance,
    venue,
    artist,
    rawRowRef: `${gig.date}:${gig.artist}@${gig.venue}`,
    confidence: 1.0,
    parseWarnings,
  };

  return event;
}
