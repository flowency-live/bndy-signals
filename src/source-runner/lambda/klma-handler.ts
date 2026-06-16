/**
 * KLMA Source Runner Lambda Handler
 *
 * Plain Node.js Lambda (zip deploy, no Docker).
 * ADR-026: Deploy structured sources as Lambda, not Fargate.
 */

import { runSource } from '../runner';
import { createRunnerDependencies } from '../runtime/createDependencies';
import { RunSourceOptions } from '../types';

// Ensure adapter is registered
import '../sources/klma-stoke/adapter';

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
  console.log('KLMA runner triggered', { event });

  const sourceId = 'klma-stoke-gig-list';
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

    console.log('KLMA run complete', {
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
    console.error('KLMA run failed', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
