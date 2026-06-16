/**
 * S3SourceRunStorage
 *
 * S3 implementation of SourceRunStorage for storing source run outputs.
 * Uses prefix: source-runs/{sourceId}/{runDate}/
 *
 * Structure:
 * - source-runs/{sourceId}/{runDate}/raw/snapshot.{csv|json}
 * - source-runs/{sourceId}/{runDate}/normalised/events.json
 * - source-runs/{sourceId}/{runDate}/normalised/parked.json
 * - source-runs/{sourceId}/{runDate}/diff/report.json
 * - source-runs/{sourceId}/{runDate}/review/items.json (gate for canCreate:false path)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { SourceConfig, NormalisedEvent, EventDiffReport, SourceRun, ReviewItem } from '../types';
import { SourceRunStorage, FetchedSource, ParsedSource } from '../runner';

export class S3SourceRunStorage implements SourceRunStorage {
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly prefix: string;

  constructor(bucketName: string, region?: string, prefix: string = 'source-runs') {
    this.bucketName = bucketName;
    this.prefix = prefix;
    this.client = new S3Client({ region: region ?? 'eu-west-2' });
  }

  /**
   * Generate S3 key for a given path under the run directory.
   */
  private makeKey(sourceId: string, runDate: string, ...pathParts: string[]): string {
    return [this.prefix, sourceId, runDate, ...pathParts].join('/');
  }

  /**
   * Write raw snapshot to S3.
   */
  async writeRawSnapshot(
    config: SourceConfig,
    run: SourceRun,
    data: FetchedSource
  ): Promise<void> {
    const extension = data.kind === 'json' ? 'json' : 'csv';
    const contentType = data.kind === 'json' ? 'application/json' : 'text/csv';
    const key = this.makeKey(config.id, run.runDate, 'raw', `snapshot.${extension}`);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: data.body,
        ContentType: contentType,
      })
    );
  }

  /**
   * Write normalised events and parked rows to S3.
   */
  async writeNormalisedOutputs(
    config: SourceConfig,
    run: SourceRun,
    parsed: ParsedSource
  ): Promise<void> {
    const eventsKey = this.makeKey(config.id, run.runDate, 'normalised', 'events.json');
    const parkedKey = this.makeKey(config.id, run.runDate, 'normalised', 'parked.json');

    await Promise.all([
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: eventsKey,
          Body: JSON.stringify(parsed.events, null, 2),
          ContentType: 'application/json',
        })
      ),
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: parkedKey,
          Body: JSON.stringify(parsed.parked, null, 2),
          ContentType: 'application/json',
        })
      ),
    ]);
  }

  /**
   * Write diff report to S3.
   */
  async writeDiffReport(
    config: SourceConfig,
    run: SourceRun,
    diff: EventDiffReport
  ): Promise<void> {
    const key = this.makeKey(config.id, run.runDate, 'diff', 'report.json');

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(diff, null, 2),
        ContentType: 'application/json',
      })
    );
  }

  /**
   * Load previous normalised events for diffing.
   * Finds the most recent run before the current runDate.
   */
  async loadPreviousNormalisedEvents(
    config: SourceConfig,
    run: SourceRun
  ): Promise<NormalisedEvent[]> {
    // List all normalised/events.json files for this source
    const listPrefix = `${this.prefix}/${config.id}/`;
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: listPrefix,
      })
    );

    if (!response.Contents || response.Contents.length === 0) {
      return [];
    }

    // Find events.json files and extract run dates
    const eventFiles = response.Contents.filter(
      (obj) => obj.Key && obj.Key.endsWith('/normalised/events.json')
    )
      .map((obj) => {
        // Extract date from key: source-runs/{sourceId}/{date}/normalised/events.json
        const parts = obj.Key!.split('/');
        const dateIndex = parts.indexOf(config.id) + 1;
        const date = parts[dateIndex];
        return {
          key: obj.Key!,
          date: date ?? '',
        };
      })
      .filter((f) => f.date && f.date !== run.runDate) // Exclude empty dates and current run
      .sort((a, b) => b.date.localeCompare(a.date)); // Sort descending

    if (eventFiles.length === 0) {
      return [];
    }

    // Load the most recent previous run
    const previousFile = eventFiles[0];
    if (!previousFile) {
      return [];
    }
    const getResponse = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: previousFile.key,
      })
    );

    if (!getResponse.Body) {
      return [];
    }

    const bodyString = await getResponse.Body.transformToString();
    return JSON.parse(bodyString) as NormalisedEvent[];
  }

  /**
   * Write review items to S3.
   * This is the gate for the canCreate:false path — without persisted review items,
   * gigs would be silently dropped instead of imported.
   * Returns the S3 URI for reference.
   */
  async writeReviewItems(
    config: SourceConfig,
    run: SourceRun,
    items: ReviewItem[]
  ): Promise<string> {
    const key = this.makeKey(config.id, run.runDate, 'review', 'items.json');

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(items, null, 2),
        ContentType: 'application/json',
      })
    );

    return `s3://${this.bucketName}/${key}`;
  }
}
