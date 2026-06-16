/**
 * On The Case Adapter Tests
 *
 * Tests the adapter that ties fetch + parse + normalise together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSourceAdapter, clearAdapterRegistry } from '../../adapter/SourceAdapter';
import { onTheCaseConfig } from './config';
import { SourceRun } from '../../types';

// Import adapter to register it
import './adapter';

// Mock Puppeteer
vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn(),
  },
}));

import puppeteer from 'puppeteer';

describe('onTheCaseAdapter', () => {
  const mockRun: SourceRun = {
    runId: 'test-run-1',
    sourceId: 'onthecase-daily-import',
    status: 'started',
    startedAt: new Date().toISOString(),
    dryRun: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup Puppeteer mock
    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(`
        <html><body>
          <div>Thursday 11 / June 2026</div>
          <div>Babel Fish at Blacksmiths Arms Gosforth</div>
          <div>200 High Street / Gosforth / 0191 213 5302</div>
          <div>9:00 PM / FREE</div>
        </body></html>
      `),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as never);
  });

  it('should be registered with correct source ID', () => {
    const adapter = getSourceAdapter('onthecase-daily-import');
    expect(adapter).toBeDefined();
  });

  it('should fetch and parse HTML content', async () => {
    const adapter = getSourceAdapter('onthecase-daily-import')!;

    const fetched = await adapter.fetch(onTheCaseConfig, mockRun);
    expect(fetched.kind).toBe('html');
    expect(fetched.body).toContain('Babel Fish');
  });

  it('should parse HTML into normalised events', async () => {
    const adapter = getSourceAdapter('onthecase-daily-import')!;

    const fetched = await adapter.fetch(onTheCaseConfig, mockRun);
    const parsed = await adapter.parse(onTheCaseConfig, mockRun, fetched);

    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].artist.sourceName).toBe('Babel Fish');
    expect(parsed.events[0].venue.sourceName).toBe('Blacksmiths Arms Gosforth');
    expect(parsed.events[0].date).toBe('2026-06-11');
  });

  it('should park skipped gigs', async () => {
    // Setup mock to return content with TBC
    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(`
        <html><body>
          <div>Thursday 11 / June 2026</div>
          <div>TBC at Some Venue Newcastle</div>
          <div>Street / Newcastle / 0191 111 1111</div>
          <div>9:00 PM / FREE</div>
        </body></html>
      `),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as never);

    const adapter = getSourceAdapter('onthecase-daily-import')!;
    const fetched = await adapter.fetch(onTheCaseConfig, mockRun);
    const parsed = await adapter.parse(onTheCaseConfig, mockRun, fetched);

    expect(parsed.events).toHaveLength(0);
    expect(parsed.parked).toHaveLength(1);
    expect(parsed.parked[0].reason).toBe('placeholder_performer');
  });
});
