/**
 * gigs-news Source Runner Lambda Handler
 *
 * Lambda with @sparticuz/chromium for JS-rendering.
 * ADR-026: Deploy JS-rendered sources as Lambda with bundled Chromium.
 */

import { runSource } from '../runner';
import { createRunnerDependencies } from '../runtime/createDependencies';
import { RunSourceOptions } from '../types';

// Ensure adapter is registered
import '../sources/gigs-news/adapter';

interface ScheduledEvent {
  'detail-type'?: string;
  source?: string;
  time?: string;
  detail?: Record<string, unknown>;
}

interface LambdaResponse {
  statusCode: number;
  body: string;
}

export async function handler(event: ScheduledEvent): Promise<LambdaResponse> {
  console.log('gigs-news runner triggered', { event });

  const sourceId = 'gigs-news-daily-import';
  const isoDate = new Date().toISOString();
  const runDate = isoDate.slice(0, 10); // YYYY-MM-DD

  const options: RunSourceOptions = {
    sourceId,
    date: runDate,
    dryRun: false,
    localStorage: false,
    reviewOnly: false,
  };

  try {
    const deps = await createRunnerDependencies(options);
    const result = await runSource(options, deps);

    console.log('gigs-news run complete', {
      status: result.run.status,
      counts: result.run.counts,
      errors: result.run.errors,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: result.run.status,
        counts: result.run.counts,
        runId: result.run.runId,
      }),
    };
  } catch (error) {
    console.error('gigs-news run failed', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
