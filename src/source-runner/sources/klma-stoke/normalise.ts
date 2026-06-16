/**
 * KLMA Normalisation
 *
 * Transforms raw KLMA rows into normalised event objects.
 * Handles time parsing, venue canonicalisation, region detection, and parking lot routing.
 */

import { createHash } from 'crypto';
import { NormalisedEvent, SourceConfig, ParkingLotReason } from '../../types';
import { KlmaRawRow } from './parse';
import { parseTime, parseDate } from './rules';
import {
  canonicaliseVenue,
  lookupVenueCanonical,
  generateVenueSlug,
  isSpecialistVenue,
  isMultiActVenue,
  detectRegion,
} from './aliases';

export interface NormaliseResult {
  success: boolean;
  event?: NormalisedEvent;
  parkReason?: ParkingLotReason;
  warnings?: string[];
}

/**
 * Generate a deterministic external ID for an event.
 * Format: klma-{hash of date+venue+artist}
 *
 * Normalises all inputs to ensure stable IDs:
 * - Venue: canonicalised (postcode stripped, apostrophe normalised)
 * - Artist: trimmed, lowercased
 */
export function generateExternalId(
  date: string,
  venue: string,
  artist: string
): string {
  const canonicalVenue = canonicaliseVenue(venue);
  const normalisedArtist = artist.trim();
  const input = `${date}|${canonicalVenue}|${normalisedArtist}`.toLowerCase();
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 12);
  return `klma-${hash}`;
}

/**
 * Generate external ID for a venue.
 */
function generateVenueExternalId(venueName: string): string {
  const canonical = canonicaliseVenue(venueName);
  const hash = createHash('sha256').update(canonical.toLowerCase()).digest('hex').slice(0, 12);
  return `klma-venue-${hash}`;
}

/**
 * Generate external ID for an artist.
 */
function generateArtistExternalId(artistName: string): string {
  const normalised = artistName.trim().toLowerCase();
  const hash = createHash('sha256').update(normalised).digest('hex').slice(0, 12);
  return `klma-artist-${hash}`;
}

/**
 * Normalise a single KLMA row into a NormalisedEvent.
 * May return a park reason instead if the row needs manual review.
 */
export function normaliseKlmaRow(
  row: KlmaRawRow,
  config: SourceConfig
): NormaliseResult {
  const warnings: string[] = [];

  // Guard: rows with empty artist or venue are not valid events
  const trimmedArtist = row.artist.trim();
  const trimmedVenue = row.venue.trim();
  if (!trimmedArtist || !trimmedVenue) {
    return {
      success: false,
      parkReason: 'non_artist_event',
      warnings: [
        !trimmedArtist ? 'Empty artist field' : '',
        !trimmedVenue ? 'Empty venue field' : '',
      ].filter(Boolean),
    };
  }

  // Parse date
  const parsedDate = parseDate(row.date);
  if (!parsedDate) {
    return {
      success: false,
      parkReason: 'unparseable',
      warnings: [`Could not parse date: ${row.date}`],
    };
  }

  // Parse time
  const timeResult = parseTime(row.time);
  let startTime = timeResult.time;
  let timeProvenance = timeResult.provenance;

  if (timeResult.warning) {
    warnings.push(timeResult.warning);
  }

  // Apply default time if missing
  if (startTime === null && config.eventPolicy.missingTimeDefault) {
    startTime = config.eventPolicy.missingTimeDefault;
    // Keep the provenance as defaulted_from_missing or defaulted_from_corrupt_time
  }

  // Canonicalise venue
  const canonicalVenue = lookupVenueCanonical(row.venue) || canonicaliseVenue(row.venue);
  const venueSlug = generateVenueSlug(canonicalVenue);

  // Check for specialist venue
  if (isSpecialistVenue(venueSlug)) {
    return {
      success: false,
      parkReason: 'specialist_venue',
      warnings,
    };
  }

  // Check for multi-act venue
  if (isMultiActVenue(venueSlug)) {
    return {
      success: false,
      parkReason: 'multi_act',
      warnings,
    };
  }

  // Detect region from venue
  const regionResult = detectRegion(row.venue);

  // Generate external IDs
  const externalId = generateExternalId(parsedDate, canonicalVenue, row.artist.trim());
  const venueExternalId = generateVenueExternalId(canonicalVenue);
  const artistExternalId = generateArtistExternalId(row.artist);

  // Build normalised event
  const event: NormalisedEvent = {
    sourceId: config.id,
    externalId,
    date: parsedDate,
    startTime,
    timeProvenance,
    venue: {
      sourceVenueExternalId: venueExternalId,
      sourceName: row.venue.trim(),
      canonicalName: canonicalVenue,
      city: regionResult.city,
      region: regionResult.region,
      nameVariants: [],
    },
    artist: {
      sourceArtistExternalId: artistExternalId,
      sourceName: row.artist.trim(),
      canonicalName: row.artist.trim(),
      region: config.defaultArtistLocation,
    },
    eventUrl: row.url.trim() || undefined,
    rawRowRef: `row:${row.rowIndex}`,
    confidence: 0.9, // Default confidence
    parseWarnings: warnings,
  };

  return {
    success: true,
    event,
    warnings,
  };
}
