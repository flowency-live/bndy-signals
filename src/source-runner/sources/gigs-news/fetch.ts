/**
 * gigs-news Fetch
 *
 * JS-rendering fetch for gigs-news.uk.
 * Uses Puppeteer because the site is client-rendered.
 *
 * ADR-026: Lambda deployment uses @sparticuz/chromium + puppeteer-core.
 * Local development falls back to regular puppeteer.
 */

import { SourceConfig, SourceRun } from '../../types';
import { FetchedSource } from '../../runner';

// Dynamic import for Lambda vs local compatibility
async function getBrowser() {
  // In Lambda, use @sparticuz/chromium
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = await import('@sparticuz/chromium');
    const puppeteer = await import('puppeteer-core');

    return puppeteer.default.launch({
      args: chromium.default.args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });
  }

  // Local development: use regular puppeteer
  const puppeteer = await import('puppeteer');
  return puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

/**
 * Fetch gigs-news page using Puppeteer for JS rendering.
 * The site is client-rendered so we need a headless browser.
 */
export async function fetchGigsNewsSource(
  config: SourceConfig,
  _run: SourceRun
): Promise<FetchedSource> {
  const url = config.input.url;
  if (!url) {
    throw new Error('URL is required for js_rendered_page input kind');
  }

  const browser = await getBrowser();

  try {
    const page = await browser.newPage();

    // Navigate and wait for network to be idle (content loaded)
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for body to exist
    await page.waitForSelector('body', { timeout: 10000 });

    // Give the JS framework time to hydrate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Return the RENDERED TEXT (matches the get_page_text the parser was built/tested against),
    // not raw HTML. page.content() handed the line-based parser HTML tags → 0 valid events.
    const content = await page.evaluate(() => document.body.innerText);
    await page.close();

    return {
      body: content,
      kind: 'html',
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}
