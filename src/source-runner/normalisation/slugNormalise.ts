/**
 * Slug Normalisation
 *
 * ADR-013: Slug-strength normalisation is THE lookup key.
 * All format variants (apostrophe, spacing, punctuation) collapse algorithmically.
 *
 * This is the SINGLE source of truth for slug normalisation.
 * Used by: aliases lookup, state store keys, resolver matching.
 */

// UK postcode regex (case-insensitive)
const UK_POSTCODE_REGEX = /\s*\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b\s*/gi;

// Curly apostrophe variants
const CURLY_APOSTROPHE = /[\u2018\u2019\u201A\u201B]/g;

/**
 * Generate a slug-strength normalised key.
 * ADR-013: This is THE lookup key - all format variants collapse.
 *
 * Transformations:
 * - Strips postcodes
 * - Lowercases
 * - Strips ALL apostrophes (curly and straight)
 * - Replaces ALL non-alphanumeric with dashes
 * - Trims leading/trailing dashes
 */
export function slugNormalise(raw: string): string {
  return raw
    .trim()
    .replace(UK_POSTCODE_REGEX, '')
    .toLowerCase()
    .replace(CURLY_APOSTROPHE, '')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
