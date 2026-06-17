/**
 * Intelligence Pass CLI
 *
 * Entry point for running the LLM-powered review item resolution.
 *
 * Commands:
 *   intelligence:run          Run intelligence pass on open review items
 *   intelligence:dry-run      Run without auto-applying (propose only)
 *
 * Options:
 *   --source-id <id>          Filter to specific source
 *   --max-items <n>           Max items to process (default: 100)
 *   --max-cost <n>            Max cost in USD (default: 1.0)
 *   --api-url <url>           bndy API base URL
 *   --bucket <name>           S3 bucket for review item storage
 */

import {
  runIntelligencePass,
  ResolverDependencies,
  ResolverRunResult,
  ReviewItemInput,
} from './index';

export interface IntelligenceCliOptions {
  dryRun: boolean;
  sourceId?: string;
  maxItems: number;
  maxCost: number;
  apiBaseUrl: string;
  bucketName?: string;
}

export interface IntelligenceCliCommand {
  command: 'run' | 'dry-run';
  options: IntelligenceCliOptions;
}

const VALID_COMMANDS = ['intelligence:run', 'intelligence:dry-run'];

const DEFAULT_API_URL = process.env.BNDY_API_URL || 'https://api.bndy.uk';
const DEFAULT_BUCKET = process.env.BNDY_SOURCE_RUNS_BUCKET || '';

export function parseCliArgs(args: string[]): IntelligenceCliCommand {
  const commandArg = args[0];
  if (!commandArg) {
    throw new Error('No command provided. Use intelligence:run or intelligence:dry-run');
  }

  if (!VALID_COMMANDS.includes(commandArg)) {
    throw new Error(`Unknown command: ${commandArg}. Use intelligence:run or intelligence:dry-run`);
  }

  const command = commandArg === 'intelligence:run' ? 'run' : 'dry-run';

  const options: IntelligenceCliOptions = {
    dryRun: command === 'dry-run',
    maxItems: 100,
    maxCost: 1.0,
    apiBaseUrl: DEFAULT_API_URL,
    bucketName: DEFAULT_BUCKET || undefined,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    switch (arg) {
      case '--source-id': {
        i++;
        const value = args[i];
        if (!value) throw new Error('--source-id requires a value');
        options.sourceId = value;
        break;
      }

      case '--max-items': {
        i++;
        const value = args[i];
        if (!value) throw new Error('--max-items requires a value');
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed <= 0) throw new Error('--max-items must be positive');
        options.maxItems = parsed;
        break;
      }

      case '--max-cost': {
        i++;
        const value = args[i];
        if (!value) throw new Error('--max-cost requires a value');
        const parsed = parseFloat(value);
        if (isNaN(parsed) || parsed <= 0) throw new Error('--max-cost must be positive');
        options.maxCost = parsed;
        break;
      }

      case '--api-url': {
        i++;
        const value = args[i];
        if (!value) throw new Error('--api-url requires a value');
        options.apiBaseUrl = value;
        break;
      }

      case '--bucket': {
        i++;
        const value = args[i];
        if (!value) throw new Error('--bucket requires a value');
        options.bucketName = value;
        break;
      }

      case '--dry-run': {
        options.dryRun = true;
        break;
      }

      default: {
        if (arg.startsWith('--')) {
          throw new Error(`Unknown option: ${arg}`);
        }
      }
    }
  }

  return { command, options };
}

/**
 * Fetch open review items from the bndy API.
 */
async function fetchReviewItems(
  apiBaseUrl: string,
  sourceId?: string
): Promise<ReviewItemInput[]> {
  let url = `${apiBaseUrl}/api/review-items?status=open`;
  if (sourceId) {
    url += `&sourceId=${encodeURIComponent(sourceId)}`;
  }

  console.log(`Fetching review items from ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch review items: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { items: Record<string, unknown>[]; count: number };
  console.log(`Found ${data.count} open review items`);

  // Transform to ReviewItemInput format
  // The API returns items with slightly different field names
  return data.items.map((item) => ({
    id: item.id as string,
    sourceId: item.sourceId as string,
    runId: item.runId as string,
    entityType: (item.entityType as 'artist' | 'venue') || 'artist',
    entityName: item.entityName as string || '',
    sourceContext: {
      venueName: undefined,
      venueRegion: undefined,
      date: undefined,
      coActs: undefined,
      sourceDefaultRegion: undefined,
    },
    candidateData: item.candidateData,
    reason: item.reason as string || item.type as string || 'review',
  }));
}

/**
 * Print a summary of the intelligence pass results.
 */
function printSummary(result: ResolverRunResult, dryRun: boolean): void {
  console.log('');
  console.log('─── Intelligence Pass Summary ───');
  console.log(`Mode:           ${dryRun ? 'DRY-RUN (no auto-apply)' : 'LIVE'}`);
  console.log(`Processed:      ${result.processed}`);
  console.log(`Auto-applied:   ${result.autoApplied}`);
  console.log(`Proposed:       ${result.proposed}`);
  console.log(`Skipped:        ${result.skipped}`);
  console.log(`Total cost:     $${result.totalCostUSD.toFixed(4)}`);
  console.log('─────────────────────────────────');

  if (result.autoApplied > 0) {
    console.log('');
    console.log('Auto-applied matches:');
    for (const r of result.results) {
      if (r.action === 'auto_applied' && r.llmOutput) {
        console.log(
          `  ✓ ${r.reviewItemId} → ${r.appliedEntityId} (${r.llmOutput.confidence}% - ${r.llmOutput.reasoning})`
        );
      }
    }
  }

  if (result.proposed > 0) {
    console.log('');
    console.log('Proposed for human review:');
    for (const r of result.results) {
      if (r.action === 'proposed' && r.llmOutput) {
        console.log(
          `  ? ${r.reviewItemId}: ${r.llmOutput.decision} (${r.llmOutput.confidence}% - ${r.llmOutput.reasoning})`
        );
      }
    }
  }

  if (result.skipped > 0) {
    console.log('');
    console.log('Skipped:');
    for (const r of result.results) {
      if (r.action === 'skipped') {
        console.log(`  ✗ ${r.reviewItemId}: ${r.error || 'unknown reason'}`);
      }
    }
  }
}

/**
 * Main CLI entry point
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const parsed = parseCliArgs(args);
    const { options } = parsed;

    console.log('bndy Intelligence Pass');
    console.log(`API URL: ${options.apiBaseUrl}`);
    console.log(`Mode: ${options.dryRun ? 'dry-run' : 'live'}`);
    if (options.sourceId) {
      console.log(`Source filter: ${options.sourceId}`);
    }
    console.log(`Max items: ${options.maxItems}`);
    console.log(`Max cost: $${options.maxCost}`);
    console.log('');

    // Fetch review items
    const items = await fetchReviewItems(options.apiBaseUrl, options.sourceId);

    if (items.length === 0) {
      console.log('No open review items to process.');
      return;
    }

    // Build dependencies
    const deps: ResolverDependencies = {
      apiBaseUrl: options.apiBaseUrl,
      config: {
        dryRun: options.dryRun,
        maxItemsPerRun: options.maxItems,
        maxCostPerRun: options.maxCost,
      },
    };

    // Add storage config if bucket is provided
    if (options.bucketName) {
      deps.storageConfig = {
        bucketName: options.bucketName,
        prefix: 'source-runs',
        region: 'eu-west-2',
      };
    }

    // Run intelligence pass
    console.log(`Processing ${Math.min(items.length, options.maxItems)} items...`);
    const result = await runIntelligencePass(items, deps);

    // Print summary
    printSummary(result, options.dryRun);

    // Exit with error if all items were skipped
    if (result.skipped === result.processed && result.processed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}

// Only run main if this file is executed directly
if (require.main === module) {
  main();
}
