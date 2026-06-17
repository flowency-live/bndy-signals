/**
 * Evidence Gathering
 *
 * Fetches detailed evidence for each candidate:
 * - Footprint (gig-geography, recency-weighted)
 * - Social handles (FB, etc.)
 * - Genres
 * - Co-billed acts
 */

import { CandidateEvidence } from './types';

interface ArtistRecord {
  id: string;
  name: string;
  location?: string;
  facebookUrl?: string;
  genres?: string[];
  // Events are fetched separately for footprint
}

interface EventRecord {
  id: string;
  venueId: string;
  date: string;
}

interface VenueRecord {
  id: string;
  name: string;
  city?: string;
  region?: string;
}

/**
 * Enrich candidates with evidence for LLM resolution.
 *
 * @param candidates - Basic candidate info from gather-candidates
 * @param apiBaseUrl - Base URL for bndy API
 * @returns Candidates enriched with footprint, social, etc.
 */
export async function gatherEvidence(
  candidates: CandidateEvidence[],
  apiBaseUrl: string
): Promise<CandidateEvidence[]> {
  // Enrich all candidates in parallel
  const enriched = await Promise.all(
    candidates.map((candidate) => enrichCandidate(candidate, apiBaseUrl))
  );
  return enriched;
}

/**
 * Enrich a single candidate with evidence.
 */
async function enrichCandidate(
  candidate: CandidateEvidence,
  apiBaseUrl: string
): Promise<CandidateEvidence> {
  try {
    // Fetch artist details for FB handle and genres
    const artistDetails = await fetchArtistDetails(candidate.id, apiBaseUrl);

    // Fetch footprint (gig-geography)
    const footprint = await fetchArtistFootprint(candidate.id, apiBaseUrl);

    return {
      ...candidate,
      fbHandle: extractFbHandle(artistDetails?.facebookUrl),
      genres: artistDetails?.genres,
      footprint,
    };
  } catch (error) {
    console.error(`[INTELLIGENCE] Failed to enrich candidate ${candidate.id}:`, error);
    return candidate; // Return original on error
  }
}

/**
 * Fetch artist details from the API.
 */
async function fetchArtistDetails(
  artistId: string,
  apiBaseUrl: string
): Promise<ArtistRecord | null> {
  try {
    // Use the public artist endpoint
    const response = await fetch(`${apiBaseUrl}/api/artists/${artistId}`);
    if (!response.ok) return null;
    return (await response.json()) as ArtistRecord;
  } catch {
    return null;
  }
}

/**
 * Fetch artist footprint (gig-geography).
 * This queries events for the artist and aggregates by venue region.
 */
async function fetchArtistFootprint(
  artistId: string,
  apiBaseUrl: string
): Promise<{ regions: Record<string, number>; totalEvents: number } | undefined> {
  try {
    // Fetch artist's events
    const eventsResponse = await fetch(`${apiBaseUrl}/api/artists/${artistId}/events`);
    if (!eventsResponse.ok) return undefined;

    const events = (await eventsResponse.json()) as EventRecord[];
    if (!events || events.length === 0) return undefined;

    // Fetch venues for region info (batch if possible, else individual)
    const venueIds = [...new Set(events.map((e) => e.venueId).filter(Boolean))];
    const venueRegions = new Map<string, string>();

    // Fetch venue details to get regions
    await Promise.all(
      venueIds.slice(0, 20).map(async (venueId) => {
        try {
          const venueResponse = await fetch(`${apiBaseUrl}/api/venues/${venueId}`);
          if (venueResponse.ok) {
            const venue = (await venueResponse.json()) as VenueRecord;
            if (venue.region || venue.city) {
              venueRegions.set(venueId, venue.region || venue.city || 'Unknown');
            }
          }
        } catch {
          // Ignore individual venue fetch errors
        }
      })
    );

    // Aggregate by region with recency weighting
    const regions: Record<string, number> = {};
    const now = new Date();

    for (const event of events) {
      const region = venueRegions.get(event.venueId);
      if (!region) continue;

      // Recency weight: more recent = higher weight
      const eventDate = new Date(event.date);
      const monthsAgo = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      const weight = Math.max(0.1, 1 - monthsAgo / 24); // Decay over 24 months

      regions[region] = (regions[region] || 0) + weight;
    }

    return {
      regions,
      totalEvents: events.length,
    };
  } catch {
    return undefined;
  }
}

/**
 * Extract FB handle from Facebook URL.
 */
function extractFbHandle(facebookUrl?: string): string | undefined {
  if (!facebookUrl) return undefined;

  // Handle various FB URL formats
  const patterns = [
    /facebook\.com\/([^/?]+)/,
    /fb\.com\/([^/?]+)/,
  ];

  for (const pattern of patterns) {
    const match = facebookUrl.match(pattern);
    if (match && match[1]) {
      const handle = match[1];
      // Skip generic paths
      if (['pages', 'profile.php', 'groups'].includes(handle)) continue;
      return handle;
    }
  }

  return undefined;
}
