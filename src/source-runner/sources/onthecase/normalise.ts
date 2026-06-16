/**
 * On The Case Normalise
 *
 * Converts OnTheCaseRawGig to NormalisedEvent.
 * Uses locality from the address line as the city.
 * Region defaults to North East England.
 */

import {
  NormalisedEvent,
  NormalisedVenueRef,
  NormalisedArtistRef,
  SourceConfig,
  TimeProvenance,
} from '../../types';
import { OnTheCaseRawGig } from './parse';

/**
 * Slugify a string for use in external IDs.
 * Lowercase, replace spaces with hyphens, remove special chars.
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/['']/g, '') // Remove apostrophes
    .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
}

/**
 * Strip trailing act qualifiers from artist name for ID generation.
 * E.g., "Andy Rayner Band" -> "Andy Rayner"
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
 * Generate external ID for an On The Case gig.
 * Format: {date}_{artist-slug}_{venue-slug}
 */
function generateExternalId(gig: OnTheCaseRawGig): string {
  const artistCore = stripActSuffix(gig.artist);
  const artistSlug = slugify(artistCore);
  const venueSlug = slugify(gig.venue);
  return `${gig.date}_${artistSlug}_${venueSlug}`;
}

/**
 * Generate venue external ID.
 * Format: venue_{venue-slug}_{locality-slug}
 */
function generateVenueExternalId(gig: OnTheCaseRawGig): string {
  const venueSlug = slugify(gig.venue);
  const localitySlug = slugify(gig.locality);
  return `venue_${venueSlug}_${localitySlug}`;
}

/**
 * Generate artist external ID.
 * Format: artist_{artist-slug}
 */
function generateArtistExternalId(gig: OnTheCaseRawGig): string {
  const artistCore = stripActSuffix(gig.artist);
  const artistSlug = slugify(artistCore);
  return `artist_${artistSlug}`;
}

/**
 * Normalise an On The Case raw gig to a NormalisedEvent.
 */
export function normaliseOnTheCaseGig(
  gig: OnTheCaseRawGig,
  config: SourceConfig
): NormalisedEvent {
  const venue: NormalisedVenueRef = {
    sourceVenueExternalId: generateVenueExternalId(gig),
    sourceName: gig.venue,
    canonicalName: gig.venue,
    city: gig.locality,
    region: config.region,
    nameVariants: [],
  };

  const artist: NormalisedArtistRef = {
    sourceArtistExternalId: generateArtistExternalId(gig),
    sourceName: gig.artist,
    canonicalName: gig.artist,
    region: config.defaultArtistLocation,
  };

  const timeProvenance: TimeProvenance = gig.startTime ? 'parsed' : 'defaulted_from_missing';

  const notes = gig.price ? `Price: ${gig.price}` : undefined;

  const event: NormalisedEvent = {
    sourceId: config.id,
    externalId: generateExternalId(gig),
    date: gig.date,
    startTime: gig.startTime,
    timeProvenance,
    venue,
    artist,
    notes,
    rawRowRef: `${gig.date}:${gig.artist}@${gig.venue}`,
    confidence: 1.0, // Fully parsed gigs have high confidence
    parseWarnings: [],
  };

  return event;
}
