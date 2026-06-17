/**
 * Review Item Storage
 *
 * Updates review item status in S3 after intelligence pass auto-applies.
 * Path: source-runs/{sourceId}/{runDate}/review/items.json
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

// Type matching the source-runner ReviewItem schema
interface StoredReviewItem {
  id: string;
  sourceId: string;
  runId: string;
  type: string;
  severity: string;
  status: 'open' | 'accepted' | 'rejected' | 'resolved';
  entityType?: string;
  entityName?: string;
  candidateData: unknown;
  reason: string;
  createdAt: string;
  // Added by intelligence pass
  resolvedAt?: string;
  resolvedBy?: string;
  resolvedEntityId?: string;
}

export interface ReviewItemStorageConfig {
  bucketName: string;
  prefix?: string;
  region?: string;
}

// S3 client (initialized lazily)
let s3Client: S3Client | null = null;

function getS3Client(region?: string): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: region ?? 'eu-west-2' });
  }
  return s3Client;
}

/**
 * Update a review item's status to 'resolved' in S3.
 *
 * @param sourceId - Source ID (e.g., 'klma-stoke-gig-list')
 * @param runDate - Run date in YYYY-MM-DD format
 * @param reviewItemId - The review item ID to update
 * @param resolvedEntityId - The entity ID it was resolved to
 * @param config - S3 storage configuration
 */
export async function markReviewItemResolved(
  sourceId: string,
  runDate: string,
  reviewItemId: string,
  resolvedEntityId: string,
  config: ReviewItemStorageConfig
): Promise<void> {
  const s3 = getS3Client(config.region);
  const prefix = config.prefix ?? 'source-runs';
  const key = `${prefix}/${sourceId}/${runDate}/review/items.json`;

  try {
    // Read existing items
    const getResponse = await s3.send(
      new GetObjectCommand({
        Bucket: config.bucketName,
        Key: key,
      })
    );

    if (!getResponse.Body) {
      console.warn(`[INTELLIGENCE] No review items file at ${key}`);
      return;
    }

    const bodyString = await getResponse.Body.transformToString();
    const items: StoredReviewItem[] = JSON.parse(bodyString);

    // Find and update the item
    const itemIndex = items.findIndex((item) => item.id === reviewItemId);
    if (itemIndex === -1) {
      console.warn(`[INTELLIGENCE] Review item ${reviewItemId} not found in ${key}`);
      return;
    }

    // Update the item
    items[itemIndex] = {
      ...items[itemIndex],
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'intelligence-pass',
      resolvedEntityId,
    };

    // Write back
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: JSON.stringify(items, null, 2),
        ContentType: 'application/json',
      })
    );

    console.log(
      `[INTELLIGENCE] Marked review item ${reviewItemId} as resolved → ${resolvedEntityId}`
    );
  } catch (error) {
    // Log but don't throw - review item update is non-critical
    // The externalId learn-back is the primary goal
    console.error(
      `[INTELLIGENCE] Failed to update review item ${reviewItemId} in S3:`,
      error
    );
  }
}

/**
 * Extract runDate from a runId if it follows the expected format.
 * Expected formats:
 * - YYYY-MM-DD (runId IS the runDate)
 * - {sourceId}-{YYYY-MM-DD} or similar
 *
 * Returns the runDate string or null if not parseable.
 */
export function extractRunDateFromRunId(runId: string): string | null {
  // Direct date format
  if (/^\d{4}-\d{2}-\d{2}$/.test(runId)) {
    return runId;
  }

  // Look for date pattern anywhere in the string
  const dateMatch = runId.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    return dateMatch[1];
  }

  return null;
}
