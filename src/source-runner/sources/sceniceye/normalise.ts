/**
 * Scenic Eye Normalise
 *
 * Converts ScenicEyeRawGig to NormalisedEvent.
 * Uses full street addresses for geocoding.
 * Region: Hampshire.
 */

import {
  NormalisedEvent,
  NormalisedVenueRef,
  NormalisedArtistRef,
  SourceConfig,
  TimeProvenance,
} from '../../types';
import { ScenicEyeRawGig } from './parse';

/**
 * Slugify a string for use in external IDs.
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/&/g, '')
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

// UK postcode + non-town trailing tokens. The town sits BEFORE the postcode; the address
// usually ends "..., <town>, <postcode>, England" (sometimes with a county before the postcode).
const UK_POSTCODE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/;
const NON_TOWN_PARTS = new Set(['england', 'uk', 'united kingdom', 'hampshire']);

/**
 * Extract the town from a venue address: walk from the end, skipping the country, a county,
 * and the postcode, and return the first real locality. Falls back to the last part.
 * (Was: blindly the last comma-part, which is always "England".)
 */
function extractCity(venueAddress: string): string {
  const parts = venueAddress.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i] as string;
    if (UK_POSTCODE.test(p)) continue;
    if (NON_TOWN_PARTS.has(p.toLowerCase())) continue;
    return p;
  }
  return parts[parts.length - 1] as string;
}

/**
 * Generate external ID for a sceniceye gig.
 * Format: {date}_{artist-slug}_{venue-slug}
 */
function generateExternalId(gig: ScenicEyeRawGig): string {
  const artistCore = stripActSuffix(gig.artist);
  const artistSlug = slugify(artistCore);
  const venueSlug = slugify(gig.venue);
  return `${gig.date}_${artistSlug}_${venueSlug}`;
}

/**
 * Generate venue external ID.
 * Format: venue_{venue-slug}
 */
function generateVenueExternalId(gig: ScenicEyeRawGig): string {
  const venueSlug = slugify(gig.venue);
  return `venue_${venueSlug}`;
}

/**
 * Generate artist external ID.
 * Format: artist_{artist-slug}
 */
function generateArtistExternalId(gig: ScenicEyeRawGig): string {
  const artistCore = stripActSuffix(gig.artist);
  const artistSlug = slugify(artistCore);
  return `artist_${artistSlug}`;
}

/**
 * Normalise a Scenic Eye raw gig to a NormalisedEvent.
 */
export function normaliseScenicEyeGig(
  gig: ScenicEyeRawGig,
  config: SourceConfig
): NormalisedEvent {
  const city = extractCity(gig.venueAddress);

  const venue: NormalisedVenueRef = {
    sourceVenueExternalId: generateVenueExternalId(gig),
    sourceName: gig.venue,
    canonicalName: gig.venue,
    city,
    region: config.region,
    nameVariants: [],
    fullAddress: gig.venueAddress,
  };

  const artist: NormalisedArtistRef = {
    sourceArtistExternalId: generateArtistExternalId(gig),
    sourceName: gig.artist,
    canonicalName: gig.artist,
    region: config.defaultArtistLocation,
  };

  // Scenic Eye always has explicit times per handoff doc
  const timeProvenance: TimeProvenance = 'parsed';
  const parseWarnings: string[] = [];

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
