/**
 * Artist Resolver
 *
 * Resolution ladder for artists:
 * 1. STATE hit → bndyId
 * 2. EXTERNAL-ID hit → bndyId (attach if missing)
 * 3. Normalise name (slug-strength) BEFORE scoring
 * 4. If name ends Band/Duo/Trio/Live/Acoustic/Show → also search stripped CORE token
 * 5. search_artist(name) — region is a SIGNAL, not a hard filter
 * 6. Require shared SIGNIFICANT token (surname) — never auto-accept top-1 by score
 * 7. Decide: exact/normalised + token agreement → MATCH; 60-90% → REVIEW; no-hit → CREATE
 */

import { NormalisedArtistRef, ResolutionAction } from '../types';
import { SourceStateStore, SourceStateEntry, ResolutionMethod } from './SourceStateStore';
import { BndyWriteClient } from '../bndy-client/BndyWriteClient';
import { slugNormalise } from '../normalisation/slugNormalise';

// Suffixes to strip for core token search
const ARTIST_SUFFIXES = [
  ' band',
  ' duo',
  ' trio',
  ' live',
  ' acoustic',
  ' show',
  ' experience',
  ' collective',
];

/**
 * Strip common artist suffixes to get the core name.
 */
function stripArtistSuffix(name: string): string | null {
  const lower = name.toLowerCase();
  for (const suffix of ARTIST_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return name.slice(0, -suffix.length).trim();
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ArtistResolutionResult {
  action: ResolutionAction;
  bndyId?: string;
  method?: ResolutionMethod;
  confidence: number;
  reasons: string[];
  reviewReason?: string;
}

export interface ResolveArtistOptions {
  stateStore: SourceStateStore;
  client: BndyWriteClient;
  /**
   * Whether CREATE_NEW is allowed. Default: false.
   *
   * Per §9 of source-runner-resolution-design.md:
   * CREATE is only reachable once matching has actually run.
   * While search rungs are stubbed/disabled, a miss is UNKNOWN, not NEW.
   * Set to true only when place_id + name-search are implemented.
   */
  canCreate?: boolean;
}

// -----------------------------------------------------------------------------
// Resolver
// -----------------------------------------------------------------------------

export async function resolveArtist(
  artistRef: NormalisedArtistRef,
  sourceId: string,
  options: ResolveArtistOptions
): Promise<ArtistResolutionResult> {
  const { stateStore, client } = options;
  const reasons: string[] = [];

  // Compute the canonical key (slug-normalised)
  const canonicalKey = slugNormalise(artistRef.canonicalName);
  reasons.push(`Canonical key: ${canonicalKey}`);

  // Step 1: STATE hit
  const stateEntry = await stateStore.get(sourceId, 'artist', canonicalKey);
  if (stateEntry) {
    reasons.push(`State hit: bndyId=${stateEntry.bndyId}`);

    // Learning write-back: add this external-id if not present
    if (!stateEntry.sourceExternalIds.includes(artistRef.sourceArtistExternalId)) {
      await stateStore.addExternalId(
        sourceId,
        'artist',
        canonicalKey,
        artistRef.sourceArtistExternalId
      );
      reasons.push(`Added external-id: ${artistRef.sourceArtistExternalId}`);
    }

    return {
      action: 'MATCH_EXISTING',
      bndyId: stateEntry.bndyId,
      method: 'state',
      confidence: stateEntry.confidence,
      reasons,
    };
  }

  // Step 4: Try stripped core token (before external-id to catch "X Band" → "X")
  const coreName = stripArtistSuffix(artistRef.canonicalName);
  if (coreName) {
    const coreKey = slugNormalise(coreName);
    reasons.push(`Checking core token: ${coreKey}`);

    const coreStateEntry = await stateStore.get(sourceId, 'artist', coreKey);
    if (coreStateEntry) {
      reasons.push(`Core token state hit: bndyId=${coreStateEntry.bndyId}`);

      // Update state for the full name too
      const now = new Date().toISOString();
      await stateStore.set(sourceId, {
        sourceCanonicalKey: canonicalKey,
        entityType: 'artist',
        bndyId: coreStateEntry.bndyId,
        method: 'token',
        confidence: 0.9,
        sourceExternalIds: [artistRef.sourceArtistExternalId],
        firstSeenAt: now,
        lastSeenAt: now,
      });

      return {
        action: 'MATCH_EXISTING',
        bndyId: coreStateEntry.bndyId,
        method: 'token',
        confidence: 0.9,
        reasons,
      };
    }
  }

  // Step 2: EXTERNAL-ID hit
  const externalIdLookup = await client.lookupByExternalId(
    artistRef.sourceArtistExternalId,
    'artist'
  );
  if (externalIdLookup) {
    reasons.push(`External-id hit: bndyId=${externalIdLookup.id}`);

    // Update state store (learning write-back)
    const now = new Date().toISOString();
    await stateStore.set(sourceId, {
      sourceCanonicalKey: canonicalKey,
      entityType: 'artist',
      bndyId: externalIdLookup.id,
      method: 'external_id',
      confidence: 0.95,
      sourceExternalIds: [artistRef.sourceArtistExternalId],
      firstSeenAt: now,
      lastSeenAt: now,
    });

    return {
      action: 'MATCH_EXISTING',
      bndyId: externalIdLookup.id,
      method: 'external_id',
      confidence: 0.95,
      reasons,
    };
  }

  // Steps 5-6 (search, token check) are DELEGATED to the server.
  // Per ADR-015: client-side resolution only does cheap fast-paths (state, external-id, core token).
  // Server's find-or-create does matching with ADR-014 confidence gate.

  // No fast-path match found:
  // ALWAYS delegate to server's find-or-create (ADR-015/021).
  // Server does footprint scoring to match; on genuine no-match, canCreate decides create-vs-review.
  // DO NOT short-circuit to REVIEW_REQUIRED here - that skips matching entirely (the 341-review bug).
  reasons.push('No state/external-id hit - delegating to server find-or-create');
  return {
    action: 'CREATE_NEW', // Signals applyWrites to call find-or-create
    confidence: 0.9, // Server will match or create
    reasons,
  };
}
