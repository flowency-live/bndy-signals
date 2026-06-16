/**
 * bndy Source Runner CLI
 *
 * Entry point for the source runner. Parses command-line arguments
 * and dispatches to the appropriate runner command.
 *
 * Commands:
 *   source:run <sourceId>      Run a full source import
 *   source:dry-run <sourceId>  Run without writing to bndy
 *   source:parse <sourceId>    Parse only, no diff or writes
 *   source:diff <sourceId>     Parse and diff, no writes
 *   source:report <sourceId>   View run report
 */

import { runSource } from './runner';
import { createRunnerDependencies } from './runtime/createDependencies';
import { RunSourceOptions, SourceRunResult } from './types';

export type CommandType = 'run' | 'dry-run' | 'parse' | 'diff' | 'report';

export interface CliOptions {
  date: string;
  dryRun: boolean;
  write: boolean;
  localStorage: boolean;
  maxWrites?: number;
  reviewOnly: boolean;
  latest?: boolean;
}

export interface CliCommand {
  command: CommandType;
  sourceId: string;
  options: CliOptions;
}

const VALID_COMMANDS = ['source:run', 'source:dry-run', 'source:parse', 'source:diff', 'source:report'];

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function extractCommand(arg: string): CommandType {
  const commandMap: Record<string, CommandType> = {
    'source:run': 'run',
    'source:dry-run': 'dry-run',
    'source:parse': 'parse',
    'source:diff': 'diff',
    'source:report': 'report',
  };
  const result = commandMap[arg];
  if (!result) {
    throw new Error(`Unknown command: ${arg}`);
  }
  return result;
}

export function parseCliArgs(args: string[]): CliCommand {
  const commandArg = args[0];
  if (!commandArg) {
    throw new Error('No command provided');
  }

  if (!VALID_COMMANDS.includes(commandArg)) {
    throw new Error(`Unknown command: ${commandArg}`);
  }

  const command = extractCommand(commandArg);

  // Source ID is the second positional argument
  const sourceId = args[1];
  if (!sourceId || sourceId.startsWith('--')) {
    throw new Error('sourceId is required');
  }

  // Parse options
  // CRITICAL: dryRun defaults to true; writes require explicit --write flag
  // See spec §27 step 8, §28.2, §29 risk mitigations
  const options: CliOptions = {
    date: getTodayDateString(),
    dryRun: true,
    write: false,
    localStorage: false,
    reviewOnly: false,
  };

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    switch (arg) {
      case '--date': {
        i++;
        const dateValue = args[i];
        if (!dateValue || !isValidDateFormat(dateValue)) {
          throw new Error('Invalid date format. Expected YYYY-MM-DD');
        }
        options.date = dateValue;
        break;
      }

      case '--dry-run': {
        options.dryRun = true;
        break;
      }

      case '--write': {
        options.write = true;
        options.dryRun = false;
        break;
      }

      case '--local-storage': {
        options.localStorage = true;
        break;
      }

      case '--max-writes': {
        i++;
        const maxWritesArg = args[i];
        if (!maxWritesArg) {
          throw new Error('max-writes requires a value');
        }
        const maxWritesValue = parseInt(maxWritesArg, 10);
        if (isNaN(maxWritesValue) || maxWritesValue <= 0) {
          throw new Error('max-writes must be positive');
        }
        options.maxWrites = maxWritesValue;
        break;
      }

      case '--review-only': {
        options.reviewOnly = true;
        break;
      }

      case '--latest': {
        options.latest = true;
        break;
      }

      default: {
        if (arg.startsWith('--')) {
          throw new Error(`Unknown option: ${arg}`);
        }
      }
    }
  }

  return {
    command,
    sourceId,
    options,
  };
}

/**
 * Print a human-readable summary of a run (the "plan" in dry-run mode).
 */
function printRunSummary(result: SourceRunResult): void {
  const c = result.run.counts;
  console.log('');
  console.log('─── Run summary ───');
  console.log(`Status:          ${result.run.status}`);
  console.log(`Valid events:    ${c.validEvents}`);
  console.log(`Parked rows:     ${c.parkedRows}`);
  if (result.diff) {
    console.log(`Added:           ${result.diff.added.length}`);
    console.log(`Cancelled cand.: ${result.diff.cancelledCandidates.length}`);
    console.log(`Unchanged:       ${result.diff.unchanged.length}`);
    console.log(`Past dropped:    ${result.diff.pastDropped.length}`);
  }
  console.log(`Events created:  ${c.eventsCreated}`);
  console.log(`Review items:    ${result.reviewItems.length}`);
  if (result.run.errors.length > 0) {
    console.log(`Errors:          ${result.run.errors.length}`);
    for (const e of result.run.errors) {
      console.log(`  - [${e.code}] ${e.message}`);
    }
  }
  console.log('───────────────────');
}

/**
 * Main CLI entry point
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const parsed = parseCliArgs(args);

    console.log(`Source: ${parsed.sourceId}`);
    console.log(`Run date: ${parsed.options.date}`);
    console.log(`Mode: ${parsed.options.dryRun ? 'dry-run' : 'direct-write'}`);

    const runOptions: RunSourceOptions = {
      sourceId: parsed.sourceId,
      date: parsed.options.date,
      dryRun: parsed.options.dryRun,
      localStorage: parsed.options.localStorage,
      maxWrites: parsed.options.maxWrites,
      reviewOnly: parsed.options.reviewOnly,
    };

    switch (parsed.command) {
      case 'run':
      case 'dry-run': {
        console.log('Running source import...');
        const deps = await createRunnerDependencies(runOptions);
        const result = await runSource(runOptions, deps);
        printRunSummary(result);
        if (result.run.status.endsWith('_failed')) {
          process.exitCode = 1;
        }
        break;
      }

      case 'parse':
      case 'diff':
      case 'report':
        console.log(
          `Command "${parsed.command}" is not yet wired to the runner; use source:run / source:dry-run.`
        );
        break;
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
