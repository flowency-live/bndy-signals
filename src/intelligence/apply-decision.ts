/**
 * Decision Application
 *
 * Applies the LLM decision:
 * - Auto-apply high-confidence MATCH (never auto-CREATE)
 * - Learn-back: attach externalId on match for future deterministic matching
 * - Update review item status in S3 to 'resolved'
 * - Log all auto-applied matches for auditability
 */

import {
  ReviewItemInput,
  LLMResolutionOutput,
  ResolutionResult,
  ResolverConfig,
} from './types';
import {
  markReviewItemResolved,
  extractRunDateFromRunId,
  ReviewItemStorageConfig,
} from './review-item-storage';
import { HttpBndyWriteClient } from '../source-runner/bndy-client';

// Type for external ID from source context or candidate data
interface SourceExternalId {
  source: string;
  id: string;
}

// Type for existing entity with external IDs
interface EntityWithExternalIds {
  id: string;
  name?: string;
  external_ids?: SourceExternalId[];
  externalIds?: SourceExternalId[];
}

export interface ApplyDecisionOptions {
  apiBaseUrl: string;
  storageConfig?: ReviewItemStorageConfig;
}

/**
 * Apply the LLM decision based on confidence and decision bands.
 *
 * Decision bands (from spec):
 * - match, confidence >= T_high (90), clear winner → AUTO-APPLY
 * - match 70-90, or two candidates within margin → HUMAN
 * - create → HUMAN (never auto-create)
 * - split → HUMAN
 * - uncertain / < T_low (70) → HUMAN
 *
 * @param item - The review item
 * @param llmOutput - The LLM's decision
 * @param config - Resolver configuration
 * @param options - API base URL and optional S3 storage config
 * @returns Resolution result with action taken
 */
export async function applyDecision(
  item: ReviewItemInput,
  llmOutput: LLMResolutionOutput,
  config: ResolverConfig,
  options: ApplyDecisionOptions
): Promise<ResolutionResult> {
  const result: ResolutionResult = {
    reviewItemId: item.id,
    action: 'proposed', // default to human review
    llmOutput,
  };

  // Never auto-apply non-MATCH decisions
  if (llmOutput.decision !== 'match') {
    console.log(`[INTELLIGENCE] Decision: ${llmOutput.decision} → proposed (non-match)`);
    return result;
  }

  // Check confidence threshold
  if (llmOutput.confidence < config.thresholdHigh) {
    console.log(
      `[INTELLIGENCE] Match confidence ${llmOutput.confidence} < ${config.thresholdHigh} → proposed`
    );
    return result;
  }

  // Check if auto-apply is enabled
  if (!config.autoApplyEnabled) {
    console.log('[INTELLIGENCE] Auto-apply disabled → proposed');
    return result;
  }

  // Dry-run mode: log but don't apply
  if (config.dryRun) {
    console.log('[INTELLIGENCE] Dry-run mode → would auto-apply but skipping');
    return result;
  }

  // Auto-apply the match
  try {
    await performAutoApply(item, llmOutput, options.apiBaseUrl);

    // Update review item status in S3 (non-blocking - failure doesn't prevent auto-apply)
    if (options.storageConfig && llmOutput.entityId) {
      const runDate = extractRunDateFromRunId(item.runId);
      if (runDate) {
        await markReviewItemResolved(
          item.sourceId,
          runDate,
          item.id,
          llmOutput.entityId,
          options.storageConfig
        );
      } else {
        console.warn(
          `[INTELLIGENCE] Could not extract runDate from runId: ${item.runId}`
        );
      }
    }

    result.action = 'auto_applied';
    result.appliedEntityId = llmOutput.entityId;

    // Create the gig's event NOW. The deterministic runner won't: on its next run the gig is
    // `unchanged` (resolveEntities only processes diff.added) so it's never re-resolved. Idempotent
    // server-side on the event externalId.
    const ev = await createResolvedEvent(item, llmOutput, options.apiBaseUrl);
    result.eventCreated = ev.created;
    if (ev.eventId) result.createdEventId = ev.eventId;

    console.log(
      `[INTELLIGENCE] AUTO-APPLIED: ${item.entityName} → ${llmOutput.entityId} (${llmOutput.confidence}%) | ` +
        (ev.created ? `event created ${ev.eventId}` : `event NOT created: ${ev.reason}`)
    );
  } catch (error) {
    result.action = 'proposed'; // Fallback to human on error
    result.error = error instanceof Error ? error.message : 'Auto-apply failed';
    console.error(`[INTELLIGENCE] Auto-apply failed for ${item.id}:`, error);
  }

  return result;
}

// The runner's NormalisedEvent, as stored in the review item's candidateData.
interface GigContext {
  externalId?: string;
  date?: string;
  startTime?: string | null;
  venue?: { sourceVenueExternalId?: string; canonicalName?: string };
  artist?: { sourceArtistExternalId?: string; canonicalName?: string };
}

/**
 * Look up an existing entity's bndy id by source external id.
 * NB: the by-external-id routes require BOTH `source` and `id` query params (the runner client's
 * single-param `externalId=` call does NOT work against them).
 */
async function lookupEntityId(
  entityType: 'artist' | 'venue',
  source: string,
  id: string,
  apiBaseUrl: string
): Promise<string | undefined> {
  const route = entityType === 'venue' ? 'venues' : 'artists';
  const url = `${apiBaseUrl}/api/${route}/by-external-id?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = (await res.json()) as Record<string, unknown>;
    if (data.found === false) return undefined;
    const nested = data[entityType] as Record<string, unknown> | undefined;
    return (nested?.id as string | undefined) ?? (data.id as string | undefined);
  } catch {
    return undefined;
  }
}

/**
 * Create the gig's public event after a high-confidence entity match. Resolves the partner entity
 * deterministically by its source external id; only creates when BOTH resolve (never fuzzy).
 * Idempotent server-side on the event externalId.
 */
async function createResolvedEvent(
  item: ReviewItemInput,
  llmOutput: LLMResolutionOutput,
  apiBaseUrl: string
): Promise<{ created: boolean; eventId?: string; reason?: string }> {
  const cd = item.candidateData as GigContext | null | undefined;
  if (!cd || !cd.externalId || !cd.date) return { created: false, reason: 'no event context' };
  if (!llmOutput.entityId) return { created: false, reason: 'no matched entityId' };

  let venueId: string | undefined;
  let artistId: string | undefined;

  if (item.entityType === 'venue') {
    venueId = llmOutput.entityId;
    if (cd.artist?.sourceArtistExternalId) {
      artistId = await lookupEntityId('artist', item.sourceId, cd.artist.sourceArtistExternalId, apiBaseUrl);
    }
  } else {
    artistId = llmOutput.entityId;
    if (cd.venue?.sourceVenueExternalId) {
      venueId = await lookupEntityId('venue', item.sourceId, cd.venue.sourceVenueExternalId, apiBaseUrl);
    }
  }

  if (!venueId || !artistId) {
    return { created: false, reason: `partner unresolved (venue=${!!venueId}, artist=${!!artistId})` };
  }

  const title =
    cd.artist?.canonicalName && cd.venue?.canonicalName
      ? `${cd.artist.canonicalName} @ ${cd.venue.canonicalName}`
      : undefined;

  const client = new HttpBndyWriteClient(apiBaseUrl);
  const res = await client.createEvent({
    externalId: cd.externalId,
    date: cd.date,
    startTime: cd.startTime ?? null,
    venueId,
    artistId,
    isPublic: true, // public discovery event
    sourceId: item.sourceId,
    title,
  });
  return res.success ? { created: true, eventId: res.eventId } : { created: false, reason: res.error };
}

/**
 * Perform the auto-apply: learn-back externalId on the matched entity.
 *
 * Note: We don't update the event/claim here - that's handled by the source runner
 * when it re-runs with the newly attached externalId.
 */
async function performAutoApply(
  item: ReviewItemInput,
  llmOutput: LLMResolutionOutput,
  apiBaseUrl: string
): Promise<void> {
  if (!llmOutput.entityId) {
    throw new Error('Cannot auto-apply: no entityId in LLM output');
  }

  // Extract external ID from candidate data if present
  const externalId = extractExternalId(item);

  if (externalId) {
    // Learn-back: attach source externalId to the matched entity
    await learnBack(llmOutput.entityId, item.entityType, externalId, apiBaseUrl);
  } else {
    console.log(`[INTELLIGENCE] No externalId to learn-back for ${item.id}`);
  }

  // Audit log
  console.log(`[INTELLIGENCE] AUDIT: Auto-applied match`, {
    reviewItemId: item.id,
    entityType: item.entityType,
    sourceName: item.entityName,
    matchedEntityId: llmOutput.entityId,
    confidence: llmOutput.confidence,
    reasoning: llmOutput.reasoning,
    evidenceUsed: llmOutput.evidenceUsed,
    act: llmOutput.act,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Extract the source externalId from the review item's candidate data.
 */
function extractExternalId(item: ReviewItemInput): SourceExternalId | null {
  // candidateData is the runner's NormalisedEvent. The deterministic source key lives on the
  // venue/artist sub-object (e.g. "venue_cowplain-social-club" / "artist_hitched") — the SAME id
  // the runner's write path stamps and looks up next run. NEVER fall back to the review-item UUID.
  const cd = item.candidateData as Record<string, unknown> | null | undefined;
  if (!cd || !item.sourceId) return null;

  if (item.entityType === 'venue') {
    const venue = cd.venue as Record<string, unknown> | undefined;
    const id = venue?.sourceVenueExternalId as string | undefined;
    return id ? { source: item.sourceId, id } : null;
  }

  const artist = cd.artist as Record<string, unknown> | undefined;
  const id = artist?.sourceArtistExternalId as string | undefined;
  return id ? { source: item.sourceId, id } : null;
}

/**
 * Learn-back: attach externalId to the matched entity.
 * This ensures the deterministic layer catches it on the next run.
 *
 * Uses the MCP update endpoint (unauthenticated) to append the externalId.
 */
export async function learnBack(
  entityId: string,
  entityType: 'artist' | 'venue',
  sourceExternalId: SourceExternalId,
  apiBaseUrl: string
): Promise<void> {
  const endpoint =
    entityType === 'artist'
      ? `${apiBaseUrl}/api/artists/${entityId}/mcp`
      : `${apiBaseUrl}/api/venues/${entityId}/mcp`;

  // First, fetch the existing entity to get current externalIds
  const existingExternalIds = await fetchExistingExternalIds(
    entityId,
    entityType,
    apiBaseUrl
  );

  // Check if this externalId is already present
  const alreadyPresent = existingExternalIds.some(
    (ext) => ext.source === sourceExternalId.source && ext.id === sourceExternalId.id
  );

  if (alreadyPresent) {
    console.log(
      `[INTELLIGENCE] ExternalId ${sourceExternalId.source}:${sourceExternalId.id} already present on ${entityType} ${entityId}`
    );
    return;
  }

  // Append the new externalId
  const updatedExternalIds = [...existingExternalIds, sourceExternalId];

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      externalIds: updatedExternalIds,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to learn-back externalId to ${entityType} ${entityId}: HTTP ${response.status}`
    );
  }

  console.log(
    `[INTELLIGENCE] Learned-back externalId ${sourceExternalId.source}:${sourceExternalId.id} → ${entityType} ${entityId}`
  );
}

/**
 * Fetch existing externalIds from an entity.
 */
async function fetchExistingExternalIds(
  entityId: string,
  entityType: 'artist' | 'venue',
  apiBaseUrl: string
): Promise<SourceExternalId[]> {
  const endpoint =
    entityType === 'artist'
      ? `${apiBaseUrl}/api/artists/${entityId}`
      : `${apiBaseUrl}/api/venues/${entityId}`;

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.warn(`[INTELLIGENCE] Could not fetch ${entityType} ${entityId}: HTTP ${response.status}`);
      return [];
    }

    const data = (await response.json()) as EntityWithExternalIds;
    // Handle both snake_case and camelCase field names
    return data.externalIds || data.external_ids || [];
  } catch (error) {
    console.warn(`[INTELLIGENCE] Error fetching ${entityType} ${entityId}:`, error);
    return [];
  }
}
