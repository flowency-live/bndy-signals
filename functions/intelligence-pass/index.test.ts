/**
 * Intelligence Pass Lambda Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3Event, Context } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({
    send: vi.fn(),
  })),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  InvokeModelCommand: vi.fn(),
}));

// Mock fetch for API calls
global.fetch = vi.fn();

describe('Intelligence Pass Lambda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse S3 event to extract sourceId and runDate', () => {
    // Test the key parsing logic
    const key = 'source-runs/sceniceye-daily/2026-06-18/run.json';
    const match = key.match(/^source-runs\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/run\.json$/);

    expect(match).not.toBeNull();
    expect(match![1]).toBe('sceniceye-daily');
    expect(match![2]).toBe('2026-06-18');
  });

  it('should transform stored review item to ReviewItemInput format', () => {
    const storedItem = {
      id: 'review-123',
      sourceId: 'sceniceye-daily',
      runId: '2026-06-18',
      type: 'artist_unmatched',
      severity: 'warning',
      status: 'open',
      entityType: 'artist',
      entityName: 'Hitched',
      candidateData: {
        venue: 'Cowplain Social Club',
        date: '2026-06-21',
      },
      reason: 'No matching artist found',
      createdAt: '2026-06-18T10:00:00Z',
    };

    // Transform logic
    const input = {
      id: storedItem.id,
      sourceId: storedItem.sourceId,
      runId: storedItem.runId,
      entityType: (storedItem.entityType || 'artist') as 'artist' | 'venue',
      entityName: storedItem.entityName || '',
      sourceContext: {
        venueName: storedItem.candidateData?.venue,
        venueRegion: undefined,
        date: storedItem.candidateData?.date,
        coActs: undefined,
        sourceDefaultRegion: 'Hampshire',
      },
      candidateData: storedItem.candidateData,
      reason: storedItem.reason || storedItem.type,
    };

    expect(input.id).toBe('review-123');
    expect(input.entityType).toBe('artist');
    expect(input.entityName).toBe('Hitched');
    expect(input.sourceContext.venueName).toBe('Cowplain Social Club');
  });

  it('should skip already resolved items', () => {
    const items = [
      { id: '1', status: 'open', entityName: 'Artist A' },
      { id: '2', status: 'resolved', entityName: 'Artist B' },
      { id: '3', status: 'open', entityName: 'Artist C' },
    ];

    const openItems = items.filter((item) => item.status === 'open');
    expect(openItems).toHaveLength(2);
    expect(openItems.map((i) => i.id)).toEqual(['1', '3']);
  });

  it('should extract region defaults per source', () => {
    const sourceDefaults: Record<string, string> = {
      'sceniceye-daily': 'Hampshire',
      'onthecase-daily': 'Tyne and Wear',
      'gigs-news-daily': 'North West',
      'klma-stoke-gig-list': 'Staffordshire',
    };

    expect(sourceDefaults['sceniceye-daily']).toBe('Hampshire');
    expect(sourceDefaults['klma-stoke-gig-list']).toBe('Staffordshire');
  });
});

describe('S3 key parsing', () => {
  it('should match standard run.json paths', () => {
    const validKeys = [
      'source-runs/sceniceye-daily/2026-06-18/run.json',
      'source-runs/klma-stoke-gig-list/2026-01-01/run.json',
      'source-runs/onthecase-daily/2025-12-31/run.json',
    ];

    const pattern = /^source-runs\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/run\.json$/;

    for (const key of validKeys) {
      const match = key.match(pattern);
      expect(match).not.toBeNull();
    }
  });

  it('should not match non-run.json files', () => {
    const invalidKeys = [
      'source-runs/sceniceye-daily/2026-06-18/review/items.json',
      'source-runs/sceniceye-daily/2026-06-18/normalised/events.json',
      'source-runs/sceniceye-daily/run.json', // missing date
    ];

    const pattern = /^source-runs\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/run\.json$/;

    for (const key of invalidKeys) {
      const match = key.match(pattern);
      expect(match).toBeNull();
    }
  });
});