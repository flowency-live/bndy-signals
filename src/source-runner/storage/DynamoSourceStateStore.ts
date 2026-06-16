/**
 * DynamoSourceStateStore
 *
 * DynamoDB implementation of SourceStateStore for entity resolution state.
 * Table: bndy-source-state-{env}
 * PK: SOURCE#{sourceId}
 * SK: ENTITY#{entityType}#{sourceCanonicalKey}
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SourceStateStore, SourceStateEntry } from '../resolution/SourceStateStore';

export class DynamoSourceStateStore implements SourceStateStore {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, region?: string) {
    this.tableName = tableName;
    const dynamoClient = new DynamoDBClient({ region: region ?? 'eu-west-2' });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  /**
   * Generate the partition key: SOURCE#{sourceId}
   */
  private makePK(sourceId: string): string {
    return `SOURCE#${sourceId}`;
  }

  /**
   * Generate the sort key: ENTITY#{entityType}#{sourceCanonicalKey}
   */
  private makeSK(entityType: 'venue' | 'artist', sourceCanonicalKey: string): string {
    return `ENTITY#${entityType}#${sourceCanonicalKey}`;
  }

  /**
   * Get a state entry by source canonical key.
   */
  async get(
    sourceId: string,
    entityType: 'venue' | 'artist',
    sourceCanonicalKey: string
  ): Promise<SourceStateEntry | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.makePK(sourceId),
          SK: this.makeSK(entityType, sourceCanonicalKey),
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    // Extract the entry from the DynamoDB item (remove PK/SK)
    const { PK, SK, ...entry } = response.Item;
    return entry as SourceStateEntry;
  }

  /**
   * Set/update a state entry.
   */
  async set(sourceId: string, entry: SourceStateEntry): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: this.makePK(sourceId),
          SK: this.makeSK(entry.entityType, entry.sourceCanonicalKey),
          ...entry,
        },
      })
    );
  }

  /**
   * Add an external ID to an existing entry.
   * Uses UpdateExpression to append without overwriting.
   */
  async addExternalId(
    sourceId: string,
    entityType: 'venue' | 'artist',
    sourceCanonicalKey: string,
    externalId: string
  ): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: this.makePK(sourceId),
          SK: this.makeSK(entityType, sourceCanonicalKey),
        },
        UpdateExpression:
          'SET sourceExternalIds = list_append(if_not_exists(sourceExternalIds, :empty), :newId), lastSeenAt = :now',
        ExpressionAttributeValues: {
          ':empty': [],
          ':newId': [externalId],
          ':now': new Date().toISOString(),
        },
        // Only update if the ID is not already in the list
        ConditionExpression:
          'attribute_exists(PK) AND NOT contains(sourceExternalIds, :externalId)',
        ExpressionAttributeNames: undefined,
      })
    ).catch((err) => {
      // Ignore ConditionalCheckFailed - means ID already exists
      if (err.name !== 'ConditionalCheckFailedException') {
        throw err;
      }
    });
  }

  /**
   * Get all entries for a source.
   * Handles pagination for large result sets.
   */
  async getAllForSource(sourceId: string): Promise<SourceStateEntry[]> {
    const entries: SourceStateEntry[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const response = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': this.makePK(sourceId),
            ':skPrefix': 'ENTITY#',
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const { PK, SK, ...entry } = item;
          entries.push(entry as SourceStateEntry);
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return entries;
  }
}
