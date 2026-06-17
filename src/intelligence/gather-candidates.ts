/**
 * Candidate Gathering
 *
 * Fetches potential matches for a review item using broad token/fuzzy search.
 * Reuses the find-or-create search logic (region as signal, not filter).
 */

import { ReviewItemInput, CandidateEvidence } from './types';

// Response types from find-or-create API
interface FindOrCreateCandidate {
  id: string;
  name: string;
  location?: string;
  confidence?: number;
  sharedToken?: boolean;
  footprintScore?: number;
  footprintRegions?: string[];
}

interface FindOrCreateResponse {
  action: 'matched' | 'review' | 'created';
  candidates?: FindOrCreateCandidate[];
  artist?: { id: string; name: string; location?: string };
}

interface VenueFindOrCreateResponse {
  id?: string;
  name?: string;
  action?: 'review';
  candidates?: Array<{
    id: string;
    name: string;
    address?: string;
    city?: string;
  }>;
}

/**
 * Gather candidate entities for a review item.
 * Calls the bndy find-or-create API to search for potential matches.
 *
 * @param item - The review item to find candidates for
 * @param apiBaseUrl - Base URL for bndy API
 * @returns Array of candidate evidence objects
 */
export async function gatherCandidates(
  item: ReviewItemInput,
  apiBaseUrl: string
): Promise<CandidateEvidence[]> {
  if (item.entityType === 'artist') {
    return gatherArtistCandidates(item, apiBaseUrl);
  } else {
    return gatherVenueCandidates(item, apiBaseUrl);
  }
}

/**
 * Gather artist candidates via POST /api/artists/find-or-create
 */
async function gatherArtistCandidates(
  item: ReviewItemInput,
  apiBaseUrl: string
): Promise<CandidateEvidence[]> {
  const response = await fetch(`${apiBaseUrl}/api/artists/find-or-create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: item.entityName,
      venueRegion: item.sourceContext.venueRegion,
      // Don't pass canCreate - we want candidates, not creation
    }),
  });

  if (!response.ok) {
    console.error(`[INTELLIGENCE] Artist find-or-create failed: ${response.status}`);
    return [];
  }

  const data = (await response.json()) as FindOrCreateResponse;

  // If matched, return the single match as a candidate
  if (data.action === 'matched' && data.artist) {
    return [
      {
        id: data.artist.id,
        name: data.artist.name,
        location: data.artist.location,
        similarity: 100, // Matched means high similarity
      },
    ];
  }

  // If review, return all candidates
  if (data.action === 'review' && data.candidates) {
    return data.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location,
      similarity: c.confidence ? c.confidence * 100 : 0,
    }));
  }

  // If created, no candidates (shouldn't happen with canCreate undefined)
  return [];
}

/**
 * Gather venue candidates via POST /api/venues/find-or-create
 */
async function gatherVenueCandidates(
  item: ReviewItemInput,
  apiBaseUrl: string
): Promise<CandidateEvidence[]> {
  const response = await fetch(`${apiBaseUrl}/api/venues/find-or-create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: item.entityName,
      city: item.sourceContext.venueRegion, // Use region as city hint
    }),
  });

  if (!response.ok) {
    console.error(`[INTELLIGENCE] Venue find-or-create failed: ${response.status}`);
    return [];
  }

  const data = (await response.json()) as VenueFindOrCreateResponse;

  // If action is review, return candidates
  if (data.action === 'review' && data.candidates) {
    return data.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      location: c.city || c.address,
      similarity: 0, // Venue candidates don't have similarity scores yet
    }));
  }

  // If found, return the matched venue as a candidate
  if (data.id) {
    return [
      {
        id: data.id,
        name: data.name || item.entityName,
        similarity: 100,
      },
    ];
  }

  return [];
}
