/**
 * On The Case Fetch Tests
 *
 * Tests JS-rendering fetch for onthecasemusic.co.uk/gigs.
 * The site is client-rendered so we need Puppeteer to get the content.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchOnTheCaseSource } from './fetch';
import { SourceConfig, SourceRun } from '../../types';

// Mock Puppeteer
vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn(),
  },
}));

import puppeteer from 'puppeteer';

const mockConfig: SourceConfig = {
  id: 'onthecase-daily-import',
  name: 'On The Case Music',
  type: 'aggregator',
  region: 'North East England',
  defaultCity: 'Newcastle upon Tyne',
  defaultArtistLocation: 'North East England UK',
  timezone: 'Europe/London',
  schedule: { cadence: 'daily', localTime: '04:05' },
  input: {
    kind: 'js_rendered_page',
    url: 'https://onthecasemusic.co.uk/gigs',
  },
  eventPolicy: {
    createPublicEvents: true,
    missingTimeDefault: '21:00',
    deleteFutureMissingRows: true,
    neverDeletePastEvents: true,
    duplicateEventBehaviour: 'attach_external_id_no_clobber',
  },
  parkingLot: {
    specialistVenueSlugs: [],
    multiActVenueSlugs: [],
    reasons: ['placeholder_performer', 'jam_night', 'private_function', 'unparseable'],
  },
  thresholds: {
    venueAutoMatch: 0.95,
    artistAutoMatch: 0.9,
    eventAutoCreate: 0.95,
    socialAutoAttach: 0.95,
  },
  snapshotSemantics: 'complete',
};

const mockRun: SourceRun = {
  runId: 'test-run-1',
  sourceId: 'onthecase-daily-import',
  status: 'started',
  startedAt: new Date().toISOString(),
  dryRun: false,
};

describe('fetchOnTheCaseSource', () => {
  let mockPage: {
    goto: ReturnType<typeof vi.fn>;
    waitForSelector: ReturnType<typeof vi.fn>;
    content: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let mockBrowser: {
    newPage: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue('<html><body>Test content</body></html>'),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should launch browser in headless mode', async () => {
    await fetchOnTheCaseSource(mockConfig, mockRun);

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
      })
    );
  });

  it('should navigate to the configured URL', async () => {
    await fetchOnTheCaseSource(mockConfig, mockRun);

    expect(mockPage.goto).toHaveBeenCalledWith(
      'https://onthecasemusic.co.uk/gigs',
      expect.objectContaining({
        waitUntil: 'networkidle2',
      })
    );
  });

  it('should wait for content to render', async () => {
    await fetchOnTheCaseSource(mockConfig, mockRun);

    // Should wait for some selector indicating content is loaded
    expect(mockPage.waitForSelector).toHaveBeenCalled();
  });

  it('should return page content as body', async () => {
    const expectedContent = '<html><body>Gig listings here</body></html>';
    mockPage.content.mockResolvedValue(expectedContent);

    const result = await fetchOnTheCaseSource(mockConfig, mockRun);

    expect(result.body).toBe(expectedContent);
    expect(result.kind).toBe('html');
  });

  it('should close browser after fetching', async () => {
    await fetchOnTheCaseSource(mockConfig, mockRun);

    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should close browser even on error', async () => {
    mockPage.goto.mockRejectedValue(new Error('Navigation failed'));

    await expect(fetchOnTheCaseSource(mockConfig, mockRun)).rejects.toThrow('Navigation failed');
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should throw if input URL is missing', async () => {
    const configWithoutUrl = {
      ...mockConfig,
      input: { kind: 'js_rendered_page' as const },
    };

    await expect(fetchOnTheCaseSource(configWithoutUrl, mockRun)).rejects.toThrow(
      /URL is required/
    );
  });
});
