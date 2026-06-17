/**
 * Intelligence Resolver
 *
 * Main orchestration for the LLM-powered resolution step (#70).
 * Pipeline: review item → gather candidates → gather evidence → LLM resolve → apply decision
 */

import {
  ReviewItemInput,
  ResolutionContext,
  ResolutionResult,
  ResolverConfig,
  DEFAULT_RESOLVER_CONFIG,
} from './types';
import { gatherCandidates } from './gather-candidates';
import { gatherEvidence } from './gather-evidence';
import { llmResolve } from './llm-resolve';
import { applyDecision } from './apply-decision';
import { ReviewItemStorageConfig } from './review-item-storage';

export interface ResolverDependencies {
  apiBaseUrl: string;
  config?: Partial<ResolverConfig>;
  /** S3 storage config for updating review item status. If not provided, status won't be updated. */
  storageConfig?: ReviewItemStorageConfig;
}

export interface ResolverRunResult {
  processed: number;
  autoApplied: number;
  proposed: number;
  skipped: number;
  totalCostUSD: number;
  results: ResolutionResult[];
}

/**
 * Resolve a single review item through the intelligence pipeline.
 *
 * Pipeline:
 * 1. Gather candidates (broad token/fuzzy search)
 * 2. Gather evidence per candidate (footprint, social, etc.)
 * 3. LLM resolve (Bedrock Claude → structured decision)
 * 4. Apply decision (auto-apply MATCH ≥ T_high, else propose)
 */
export async function resolveItem(
  item: ReviewItemInput,
  deps: ResolverDependencies
): Promise<ResolutionResult> {
  const config: ResolverConfig = {
    ...DEFAULT_RESOLVER_CONFIG,
    ...deps.config,
  };

  try {
    // Step 1: Gather candidates
    const basicCandidates = await gatherCandidates(item, deps.apiBaseUrl);

    if (basicCandidates.length === 0) {
      return {
        reviewItemId: item.id,
        action: 'skipped',
        error: 'No candidates found',
      };
    }

    // Step 2: Gather evidence for each candidate
    const enrichedCandidates = await gatherEvidence(basicCandidates, deps.apiBaseUrl);

    // Step 3: LLM resolve
    const context: ResolutionContext = {
      item,
      candidates: enrichedCandidates,
    };
    const llmResult = await llmResolve(context, config);

    // Step 4: Apply decision
    const result = await applyDecision(item, llmResult.output, config, {
      apiBaseUrl: deps.apiBaseUrl,
      storageConfig: deps.storageConfig,
    });
    result.cost = llmResult.cost;

    return result;
  } catch (error) {
    return {
      reviewItemId: item.id,
      action: 'skipped',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Run the intelligence pass on a batch of review items.
 * Respects cost ceiling and max items per run.
 */
export async function runIntelligencePass(
  items: ReviewItemInput[],
  deps: ResolverDependencies
): Promise<ResolverRunResult> {
  const config: ResolverConfig = {
    ...DEFAULT_RESOLVER_CONFIG,
    ...deps.config,
  };

  const results: ResolutionResult[] = [];
  let totalCostUSD = 0;
  let autoApplied = 0;
  let proposed = 0;
  let skipped = 0;

  for (const item of items.slice(0, config.maxItemsPerRun)) {
    // Check cost ceiling
    if (totalCostUSD >= config.maxCostPerRun) {
      console.log(`[INTELLIGENCE] Cost ceiling reached ($${totalCostUSD.toFixed(4)})`);
      break;
    }

    const result = await resolveItem(item, deps);
    results.push(result);

    // Track stats
    if (result.cost) {
      totalCostUSD += result.cost.estimatedCostUSD;
    }

    switch (result.action) {
      case 'auto_applied':
        autoApplied++;
        break;
      case 'proposed':
        proposed++;
        break;
      case 'skipped':
        skipped++;
        break;
    }
  }

  return {
    processed: results.length,
    autoApplied,
    proposed,
    skipped,
    totalCostUSD,
    results,
  };
}
