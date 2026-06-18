/**
 * Intelligence Pass Lambda
 *
 * Triggered after each source run completes (S3 run.json write).
 * Processes the run's review/items.json and resolves parked gigs using LLM.
 *
 * Decision policy:
 * - Auto-apply MATCH ≥ 90% (resolve to existing entity, create event)
 * - NEVER auto-CREATE (entity creation is human-gated)
 * - Everything else → HITL review item
 *
 * Model: Bedrock Haiku 4.5
 * Spec: bndy brain/04-architecture/intelligence-resolver-spec.md
 */

import { Handler, S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  runIntelligencePass,
  ResolverDependencies,
  ReviewItemInput,
} from '../../src/intelligence';

// Environment
const BUCKET_NAME = process.env.SOURCE_RUNS_BUCKET || 'bndy-signals-prod-771551874768';
const API_BASE_URL = process.env.BNDY_API_URL || 'https://api.bndy.co.uk';
const MAX_ITEMS_PER_RUN = parseInt(process.env.MAX_ITEMS_PER_RUN || '50', 10);
const MAX_COST_PER_RUN = parseFloat(process.env.MAX_COST_PER_RUN || '1.0');
const DRY_RUN = process.env.DRY_RUN === 'true';

// Source-specific default regions (for context in LLM resolution)
const SOURCE_DEFAULT_REGIONS: Record<string, string> = {
  'sceniceye-daily-import': 'Hampshire',
  'onthecase-daily-import': 'North East England',
  'gigs-news-daily-import': 'Greater Manchester / East Cheshire',
  'klma-stoke-gig-list': 'Staffordshire',
};

// S3 client
const s3 = new S3Client({ region: 'eu-west-2' });

// Stored review item format (from source-runner)
interface StoredReviewItem {
  id: string;
  sourceId: string;
  runId: string;
  type: string;
  severity: string;
  status: 'open' | 'accepted' | 'rejected' | 'resolved';
  entityType?: string;
  entityName?: string;
  candidateData?: Record<string, unknown>;
  reason: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolvedEntityId?: string;
}

// Output format
interface IntelligencePassOutput {
  sourceId: string;
  runDate: string;
  processed: number;
  autoApplied: number;
  eventsCreated: number;
  proposed: number;
  skipped: number;
  totalCostUSD: number;
  runtimeMs: number;
}

/**
 * Parse S3 key to extract sourceId and runDate.
 * Expected format: source-runs/{sourceId}/{runDate}/run.json
 */
function parseS3Key(key: string): { sourceId: string; runDate: string } | null {
  const match = key.match(/^source-runs\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/run\.json$/);
  if (!match || !match[1] || !match[2]) return null;
  return { sourceId: match[1], runDate: match[2] };
}

/**
 * Fetch review items from S3.
 */
async function fetchReviewItems(
  sourceId: string,
  runDate: string
): Promise<StoredReviewItem[]> {
  const key = `source-runs/${sourceId}/${runDate}/review/items.json`;

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );

    if (!response.Body) {
      console.log(`[INTELLIGENCE-PASS] No review items file at ${key}`);
      return [];
    }

    const bodyString = await response.Body.transformToString();
    const items = JSON.parse(bodyString) as StoredReviewItem[];
    return items;
  } catch (error) {
    // NoSuchKey is expected if no review items
    if ((error as { name?: string }).name === 'NoSuchKey') {
      console.log(`[INTELLIGENCE-PASS] No review items file at ${key}`);
      return [];
    }
    throw error;
  }
}

/**
 * Transform stored review item to ReviewItemInput format.
 */
function transformToReviewItemInput(
  item: StoredReviewItem,
  sourceDefaultRegion?: string
): ReviewItemInput {
  // candidateData is the runner's NormalisedEvent — venue/artist are OBJECTS, not strings.
  const eventData = (item.candidateData || {}) as Record<string, unknown>;
  const venueObj = (eventData.venue || {}) as Record<string, unknown>;
  const venueName = (venueObj.canonicalName as string | undefined) ||
    (venueObj.sourceName as string | undefined);
  const venueRegion = (venueObj.region as string | undefined) ||
    (venueObj.city as string | undefined);
  const date = eventData.date as string | undefined;
  const coActs = eventData.coActs as string[] | undefined; // not in model yet; forward-compat

  return {
    id: item.id,
    sourceId: item.sourceId,
    runId: item.runId,
    entityType: (item.entityType || 'artist') as 'artist' | 'venue',
    entityName: item.entityName || '',
    sourceContext: {
      venueName,
      venueRegion,
      date,
      coActs,
      sourceDefaultRegion,
    },
    candidateData: item.candidateData,
    reason: item.reason || item.type,
  };
}

/**
 * Write intelligence pass results to S3.
 */
async function writeResults(
  sourceId: string,
  runDate: string,
  results: IntelligencePassOutput
): Promise<void> {
  const key = `source-runs/${sourceId}/${runDate}/intelligence/pass-result.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(results, null, 2),
      ContentType: 'application/json',
    })
  );

  console.log(`[INTELLIGENCE-PASS] Wrote results to ${key}`);
}

/**
 * Lambda handler - triggered by S3 run.json write.
 */
export const handler: Handler<S3Event, IntelligencePassOutput | null> = async (event) => {
  const startTime = Date.now();

  // Extract S3 key from event
  const record = event.Records?.[0];
  if (!record) {
    console.log('[INTELLIGENCE-PASS] No S3 records in event');
    return null;
  }

  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  console.log(`[INTELLIGENCE-PASS] Triggered by: ${key}`);

  // Parse key
  const parsed = parseS3Key(key);
  if (!parsed) {
    console.log(`[INTELLIGENCE-PASS] Not a run.json trigger, skipping: ${key}`);
    return null;
  }

  const { sourceId, runDate } = parsed;
  console.log(`[INTELLIGENCE-PASS] Processing ${sourceId} run ${runDate}`);

  // Fetch review items
  const storedItems = await fetchReviewItems(sourceId, runDate);
  console.log(`[INTELLIGENCE-PASS] Found ${storedItems.length} review items`);

  // Filter to open items only
  const openItems = storedItems.filter((item) => item.status === 'open');
  console.log(`[INTELLIGENCE-PASS] ${openItems.length} open items to process`);

  if (openItems.length === 0) {
    const result: IntelligencePassOutput = {
      sourceId,
      runDate,
      processed: 0,
      autoApplied: 0,
      eventsCreated: 0,
      proposed: 0,
      skipped: 0,
      totalCostUSD: 0,
      runtimeMs: Date.now() - startTime,
    };
    await writeResults(sourceId, runDate, result);
    return result;
  }

  // Transform to ReviewItemInput format
  const sourceDefaultRegion = SOURCE_DEFAULT_REGIONS[sourceId];
  const reviewItemInputs = openItems.map((item) =>
    transformToReviewItemInput(item, sourceDefaultRegion)
  );

  // Build dependencies
  const deps: ResolverDependencies = {
    apiBaseUrl: API_BASE_URL,
    config: {
      dryRun: DRY_RUN,
      maxItemsPerRun: MAX_ITEMS_PER_RUN,
      maxCostPerRun: MAX_COST_PER_RUN,
      autoApplyEnabled: !DRY_RUN,
    },
    storageConfig: {
      bucketName: BUCKET_NAME,
      prefix: 'source-runs',
      region: 'eu-west-2',
    },
  };

  // Run intelligence pass
  console.log(`[INTELLIGENCE-PASS] Running on ${reviewItemInputs.length} items (dry-run: ${DRY_RUN})`);
  const passResult = await runIntelligencePass(reviewItemInputs, deps);

  // Build output
  const result: IntelligencePassOutput = {
    sourceId,
    runDate,
    processed: passResult.processed,
    autoApplied: passResult.autoApplied,
    eventsCreated: passResult.eventsCreated,
    proposed: passResult.proposed,
    skipped: passResult.skipped,
    totalCostUSD: passResult.totalCostUSD,
    runtimeMs: Date.now() - startTime,
  };

  // Log results
  console.log(`[INTELLIGENCE-PASS] Complete:`, {
    processed: result.processed,
    autoApplied: result.autoApplied,
    eventsCreated: result.eventsCreated,
    proposed: result.proposed,
    skipped: result.skipped,
    cost: `$${result.totalCostUSD.toFixed(4)}`,
    runtime: `${result.runtimeMs}ms`,
  });

  // Log auto-applied matches for audit trail
  for (const r of passResult.results) {
    if (r.action === 'auto_applied' && r.llmOutput) {
      console.log(`[INTELLIGENCE-PASS] AUDIT - Auto-applied:`, {
        reviewItemId: r.reviewItemId,
        matchedEntityId: r.appliedEntityId,
        confidence: r.llmOutput.confidence,
        reasoning: r.llmOutput.reasoning,
        evidenceUsed: r.llmOutput.evidenceUsed,
      });
    }
  }

  // Write results to S3
  await writeResults(sourceId, runDate, result);

  return result;
};