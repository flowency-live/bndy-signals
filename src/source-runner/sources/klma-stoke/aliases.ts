/**
 * KLMA Venue Aliases and Canonicalisation
 *
 * Handles venue name normalisation and alias lookup.
 * ADR-013: Uses slug-strength normalisation for lookup key - all format variants
 * (apostrophe, spacing, punctuation) collapse algorithmically. Only genuine
 * different-name variants need to be listed in clusters.
 */

import { slugNormalise } from '../../normalisation/slugNormalise';

// UK postcode regex (case-insensitive)
const UK_POSTCODE_REGEX = /\s*\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b\s*/gi;

// Curly apostrophe variants
const CURLY_APOSTROPHE = /[\u2018\u2019\u201A\u201B]/g;

// " in <Town>" pattern -> ", <Town>"
const IN_TOWN_PATTERN = /\s+in\s+(\w+)$/i;

/**
 * Canonicalise a venue string according to KLMA rules:
 * 1. Trim whitespace
 * 2. Normalise curly apostrophe to straight
 * 3. Strip embedded UK postcode
 * 4. Normalise " in <Town>" to ", <Town>"
 */
export function canonicaliseVenue(raw: string): string {
  let result = raw.trim();
  result = result.replace(CURLY_APOSTROPHE, "'");
  result = result.replace(UK_POSTCODE_REGEX, '').trim();
  result = result.replace(IN_TOWN_PATTERN, ', $1');
  return result;
}

/**
 * Generate a URL-safe slug from a venue name.
 * Uses the same normalisation as lookup for consistency.
 */
export function generateVenueSlug(venue: string): string {
  return slugNormalise(venue);
}

// Venue clusters - ADR-013 compliant
// List variants that produce DIFFERENT slugs than the canonical.
// Format variants (apostrophe, punctuation within same structure) collapse automatically.
//
// What collapses automatically (same slug):
//   "The Nag's Head, Macclesfield" ≈ "The Nags Head, Macclesfield" (apostrophe)
//   "Swiftys, Meir" ≈ "Swiftys. Meir" (punctuation)
//
// What needs explicit listing (different slug):
//   "The Rigger" vs "The Rigger, Newcastle-under-Lyme" (missing town)
//   "Swiftys" vs "Swiftys, Meir" (missing town)
//   "in Macclesfield" vs ", Macclesfield" ("in" becomes slug content)
const VENUE_CLUSTERS: Array<{
  canonical: string;
  differentSlugVariants: string[]; // Variants with different slugs that map to this canonical
  region?: string;
  flag?: string;
  bndyId?: string;
}> = [
  {
    canonical: 'The Nags Head, Macclesfield',
    differentSlugVariants: [
      'The Nags Head in Macclesfield', // "in" makes different slug
    ],
    region: 'Cheshire',
  },
  {
    canonical: 'The Cosey, Haslington',
    differentSlugVariants: [
      'The Cosey Haslington', // No comma
      'The Cosey Club Near Crewe', // Different suffix
      'Cosey Club Haslington', // "Cosey Club" not "The Cosey"
    ],
    region: 'Cheshire',
  },
  {
    canonical: 'The Rigger, Newcastle-under-Lyme',
    differentSlugVariants: [
      'The Rigger', // No town
      'The Rigger Venue', // Has "Venue" suffix, no town
      'The Rigger Venue, Newcastle-under-Lyme', // Has "Venue" suffix with town
    ],
    region: 'Staffordshire',
    flag: 'multi_act',
  },
  {
    canonical: 'Artisan Tap, Hartshill',
    differentSlugVariants: [
      'Artisan Tap', // No town
      'The Artisan Tap', // Has "The" prefix
    ],
    region: 'Staffordshire',
    flag: 'specialist',
  },
  {
    canonical: 'The Queens Hotel, Macclesfield',
    differentSlugVariants: [
      'The Queens Hotel Macclesfield', // No comma
    ],
    region: 'Cheshire',
  },
  {
    canonical: 'Crewe Market Hall',
    differentSlugVariants: [
      'Market Hall, Crewe', // Different word order
    ],
    region: 'Cheshire',
  },
  {
    canonical: 'Alsager Civic',
    differentSlugVariants: [],
    region: 'Cheshire',
  },
  {
    canonical: 'Swiftys, Meir',
    differentSlugVariants: [
      'Swiftys', // No town - maps to same canonical
    ],
    region: 'Staffordshire',
    bndyId: 'aayxv4IGQbBmXBpk7WZL',
  },
  {
    canonical: 'The Swan, Stone',
    differentSlugVariants: [],
    region: 'Staffordshire',
    bndyId: '74BjwiHSxHDxdUghRVB9',
  },
  {
    canonical: 'The Moorland Inn, Burslem',
    differentSlugVariants: [
      'Moorland Inn Burslem', // No "The", no comma
      'Moorland Inn Smallthorne', // Different town
    ],
    region: 'Staffordshire',
    bndyId: 'hbXt7haW5QcV06fHixD0',
  },
  {
    canonical: 'The Roebuck, Forsbrook',
    differentSlugVariants: [
      'Roebuck Forsbrook', // No "The", no comma
    ],
    region: 'Staffordshire',
    bndyId: 'I7RcAfPu0g4DP7kXdlaL',
  },
];

// Build lookup map: slug -> canonical
// ADR-013: Key on slug-strength normalisation
const SLUG_LOOKUP: Map<string, string> = new Map();
for (const cluster of VENUE_CLUSTERS) {
  // Map the canonical's slug
  SLUG_LOOKUP.set(slugNormalise(cluster.canonical), cluster.canonical);
  // Map any different-slug variants
  for (const variant of cluster.differentSlugVariants) {
    SLUG_LOOKUP.set(slugNormalise(variant), cluster.canonical);
  }
}

// Specialist venue slug prefixes
const SPECIALIST_VENUE_PREFIXES = ['artisan-tap', 'eleven'];

// Multi-act venue slug prefixes (token-based matching like specialist)
const MULTI_ACT_VENUE_PREFIXES = ['the-rigger'];

// Cheshire towns for region detection
const CHESHIRE_TOWNS = [
  'Crewe',
  'Macclesfield',
  'Haslington',
  'Sandbach',
  'Congleton',
  'Nantwich',
  'Alsager',
  'Wilmslow',
  'Knutsford',
  'Audlem',
];

// Staffordshire towns for region detection
const STAFFORDSHIRE_TOWNS = [
  'Stoke-on-Trent',
  'Stone',
  'Leek',
  'Newcastle-under-Lyme',
  'Newcastle',
  'Stafford',
  'Uttoxeter',
  'Cheadle',
  'Biddulph',
  'Kidsgrove',
  'Ipstones',
  'Wyrley',
  'Burslem',
  'Hartshill',
  'Meir',
  'Forsbrook',
  'Sandyford',
  'Smallthorne',
];

/**
 * Lookup canonical name for a venue variant.
 * ADR-013: Uses slug-strength key - all format variants match algorithmically.
 * Returns null if not found in known clusters.
 */
export function lookupVenueCanonical(raw: string): string | null {
  const slug = slugNormalise(raw);
  return SLUG_LOOKUP.get(slug) || null;
}

/**
 * Check if a venue slug indicates a specialist venue.
 * Specialist venues need special handling (ticketed, curated events).
 */
export function isSpecialistVenue(slug: string): boolean {
  return SPECIALIST_VENUE_PREFIXES.some((prefix) => slug.startsWith(prefix));
}

/**
 * Check if a venue slug indicates a multi-act venue.
 * Multi-act venues need lineup resolution.
 * Uses token-based prefix matching (like specialist venues).
 */
export function isMultiActVenue(slug: string): boolean {
  return MULTI_ACT_VENUE_PREFIXES.some((prefix) => slug.startsWith(prefix));
}

export interface RegionResult {
  region: string;
  city: string;
}

/**
 * Extract potential town from venue string.
 * Tries trailing comma segment first, then embedded town references.
 */
function extractTownCandidate(venueString: string): string | null {
  const commaMatch = venueString.match(/,\s*([^,]+)$/);
  if (commaMatch && commaMatch[1]) {
    return commaMatch[1].trim();
  }
  return null;
}

/**
 * Find a matching town in the given list (case-insensitive).
 * Returns the properly-cased town name if found.
 */
function findTownInList(text: string, towns: readonly string[]): string | null {
  const normalised = text.toLowerCase();
  for (const town of towns) {
    if (normalised.includes(town.toLowerCase())) {
      return town;
    }
  }
  return null;
}

/**
 * Detect region from venue string.
 * 1. Check for Cheshire towns -> Cheshire region
 * 2. Check for Staffordshire towns -> Staffordshire region
 * 3. Try to extract town from trailing comma segment
 * 4. If no town derivable -> empty city, Staffordshire default
 */
export function detectRegion(venueString: string): RegionResult {
  const cheshireTown = findTownInList(venueString, CHESHIRE_TOWNS);
  if (cheshireTown) {
    return { region: 'Cheshire', city: cheshireTown };
  }

  const staffsTown = findTownInList(venueString, STAFFORDSHIRE_TOWNS);
  if (staffsTown) {
    return { region: 'Staffordshire', city: staffsTown };
  }

  const townCandidate = extractTownCandidate(venueString);
  if (townCandidate) {
    return { region: 'Staffordshire', city: townCandidate };
  }

  return { region: 'Staffordshire', city: '' };
}
