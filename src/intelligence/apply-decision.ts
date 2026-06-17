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
    console.log(
      `[INTELLIGENCE] AUTO-APPLIED: ${item.entityName} → ${llmOutput.entityId} (${llmOutput.confidence}%)`
    );
  } catch (error) {
    result.action = 'proposed'; // Fallback to human on error
    result.error = error instanceof Error ? error.message : 'Auto-apply failed';
    console.error(`[INTELLIGENCE] Auto-apply failed for ${item.id}:`, error);
  }

  return result;
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
  // candidateData may contain the source external ID
  const candidateData = item.candidateData as Record<string, unknown> | null;
  if (!candidateData) return null;

  // Check common patterns for external ID storage
  if (candidateData.externalId && typeof candidateData.externalId === 'object') {
    const extId = candidateData.externalId as SourceExternalId;
    if (extId.source && extId.id) {
      return extId;
    }
  }

  // Check externalIds array
  if (Array.isArray(candidateData.externalIds) && candidateData.externalIds.length > 0) {
    const first = candidateData.externalIds[0] as SourceExternalId;
    if (first.source && first.id) {
      return first;
    }
  }

  // Fallback: construct from sourceId + item id
  if (item.sourceId) {
    return {
      source: item.sourceId,
      id: item.id,
    };
  }

  return null;
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
