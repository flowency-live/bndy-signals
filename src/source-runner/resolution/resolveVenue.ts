/**
 * Venue Resolver
 *
 * Resolution ladder for venues:
 * 1. STATE hit → return bndyId
 * 2. EXTERNAL-ID hit → bndyId (attach if missing)
 * 3. PLACE_ID → bndyId (strongest; requires Google API)
 * 4. NAME+TOWN search → accept only with town/region corroboration
 * 5. TOKEN fuzzy (last resort)
 * 6. Decide: strong hit → MATCH; 60-90% → REVIEW; no-hit → CREATE
 */

import { NormalisedVenueRef, ResolutionAction } from '../types';
import { SourceStateStore, SourceStateEntry, ResolutionMethod } from './SourceStateStore';
import { BndyWriteClient } from '../bndy-client/BndyWriteClient';
import { slugNormalise } from '../normalisation/slugNormalise';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface VenueResolutionResult {
  action: ResolutionAction;
  bndyId?: string;
  method?: ResolutionMethod;
  confidence: number;
  reasons: string[];
  reviewReason?: string;
}

export interface ResolveVenueOptions {
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

export async function resolveVenue(
  venueRef: NormalisedVenueRef,
  sourceId: string,
  options: ResolveVenueOptions
): Promise<VenueResolutionResult> {
  const { stateStore, client } = options;
  const reasons: string[] = [];

  // Compute the canonical key (slug-normalised)
  const canonicalKey = slugNormalise(venueRef.canonicalName);
  reasons.push(`Canonical key: ${canonicalKey}`);

  // Step 1: STATE hit
  const stateEntry = await stateStore.get(sourceId, 'venue', canonicalKey);
  if (stateEntry) {
    reasons.push(`State hit: bndyId=${stateEntry.bndyId}`);

    // Learning write-back: add this external-id if not present
    if (!stateEntry.sourceExternalIds.includes(venueRef.sourceVenueExternalId)) {
      await stateStore.addExternalId(
        sourceId,
        'venue',
        canonicalKey,
        venueRef.sourceVenueExternalId
      );
      reasons.push(`Added external-id: ${venueRef.sourceVenueExternalId}`);
    }

    return {
      action: 'MATCH_EXISTING',
      bndyId: stateEntry.bndyId,
      method: 'state',
      confidence: stateEntry.confidence,
      reasons,
    };
  }

  // Step 2: EXTERNAL-ID hit
  const externalIdLookup = await client.lookupByExternalId(
    venueRef.sourceVenueExternalId,
    'venue'
  );
  if (externalIdLookup) {
    reasons.push(`External-id hit: bndyId=${externalIdLookup.id}`);

    // Update state store (learning write-back)
    const now = new Date().toISOString();
    await stateStore.set(sourceId, {
      sourceCanonicalKey: canonicalKey,
      entityType: 'venue',
      bndyId: externalIdLookup.id,
      method: 'external_id',
      confidence: 0.95,
      sourceExternalIds: [venueRef.sourceVenueExternalId],
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

  // Steps 3-5 (place_id, name+town, token fuzzy) are DELEGATED to the server.
  // Per ADR-015: client-side resolution only does cheap fast-paths (state, external-id).
  // Server's find-or-create does geocode→place_id matching (ADR-018).

  // No fast-path match found:
  // ALWAYS delegate to server's find-or-create (ADR-015/018).
  // Server does place_id geocode matching; on genuine no-match, canCreate decides create-vs-review.
  // DO NOT short-circuit to REVIEW_REQUIRED here - that skips matching entirely (the 341-review bug).
  reasons.push('No state/external-id hit - delegating to server find-or-create');
  return {
    action: 'CREATE_NEW', // Signals applyWrites to call find-or-create
    confidence: 0.9, // Server will match or create with geocoded place_id
    reasons,
  };
}
