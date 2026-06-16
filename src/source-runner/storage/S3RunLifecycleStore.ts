/**
 * S3RunLifecycleStore
 *
 * S3 implementation of SourceStateStore for persisting run lifecycle records.
 * Writes run records to: source-runs/{sourceId}/{runDate}/run.json
 *
 * This replaces the InMemoryRunLifecycleStore to enable the source dashboard
 * to query run history and status.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { SourceConfig, SourceRun, SourceRunCounts, RunSourceOptions } from '../types';
import { SourceStateStore, WriteResult } from '../runner';

export class S3RunLifecycleStore implements SourceStateStore {
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly prefix: string;

  constructor(bucketName: string, region?: string, prefix = 'source-runs') {
    this.bucketName = bucketName;
    this.prefix = prefix;
    this.client = new S3Client({ region: region ?? 'eu-west-2' });
  }

  /**
   * Generate S3 key for the run record.
   */
  private makeKey(sourceId: string, runDate: string): string {
    return `${this.prefix}/${sourceId}/${runDate}/run.json`;
  }

  /**
   * Create empty counts structure.
   */
  private emptyCounts(): SourceRunCounts {
    return {
      rawRows: 0,
      validEvents: 0,
      metadataRows: 0,
      parkedRows: 0,
      added: 0,
      cancelled: 0,
      unchanged: 0,
      pastDropped: 0,
      eventsCreated: 0,
      eventsRepointed: 0,
      eventsDeleted: 0,
      eventsHidden: 0,
      venuesCreated: 0,
      venuesMatched: 0,
      artistsCreated: 0,
      artistsMatched: 0,
      reviewItems: 0,
    };
  }

  /**
   * Start a new run. Creates an in-memory SourceRun record.
   * The record is persisted on completeRun.
   */
  async startRun(config: SourceConfig, options: RunSourceOptions): Promise<SourceRun> {
    return {
      sourceId: config.id,
      runId: randomUUID(),
      runDate: options.date,
      startedAt: new Date().toISOString(),
      status: 'started',
      counts: this.emptyCounts(),
      errors: [],
    };
  }

  /**
   * Complete the run and persist the record to S3.
   * This is called in a finally block so failed runs are also persisted.
   */
  async completeRun(config: SourceConfig, run: SourceRun, _reportPath?: string): Promise<void> {
    const completedRun: SourceRun = {
      ...run,
      completedAt: run.completedAt ?? new Date().toISOString(),
    };

    const key = this.makeKey(config.id, run.runDate);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(completedRun, null, 2),
        ContentType: 'application/json',
      })
    );
  }

  /**
   * Persist intermediate run state. Currently a no-op.
   * State is accumulated in the run object and written once on completeRun.
   */
  async persistRunState(_config: SourceConfig, _run: SourceRun, _result: WriteResult): Promise<void> {
    // No-op: state is accumulated in the run object during the run
    // and persisted once at the end via completeRun.
  }
}
