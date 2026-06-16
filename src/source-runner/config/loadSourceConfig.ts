/**
 * Source Configuration Loader
 *
 * Loads source-specific configuration for the runner.
 * Each source has its own config module in sources/<sourceId>/config.ts
 */

import { SourceConfig, SourceConfigSchema } from '../types';

// Import source configs
import { klmaStokeConfig } from '../sources/klma-stoke/config';
import { onTheCaseConfig } from '../sources/onthecase/config';
import { gigsNewsConfig } from '../sources/gigs-news/config';
import { scenicEyeConfig } from '../sources/sceniceye/config';

// Import adapters to register them
import '../sources/klma-stoke/adapter';
import '../sources/onthecase/adapter';
import '../sources/gigs-news/adapter';
import '../sources/sceniceye/adapter';

// Registry of available source configs
const SOURCE_CONFIGS: Record<string, SourceConfig> = {
  'klma-stoke-gig-list': klmaStokeConfig,
  'onthecase-daily-import': onTheCaseConfig,
  'gigs-news-daily-import': gigsNewsConfig,
  'sceniceye-daily-import': scenicEyeConfig,
};

export class SourceConfigNotFoundError extends Error {
  constructor(sourceId: string) {
    super(`Source config not found: ${sourceId}`);
    this.name = 'SourceConfigNotFoundError';
  }
}

/**
 * Load and validate a source configuration by ID
 */
export async function loadSourceConfig(sourceId: string): Promise<SourceConfig> {
  const config = SOURCE_CONFIGS[sourceId];

  if (!config) {
    throw new SourceConfigNotFoundError(sourceId);
  }

  // Validate the config against the schema
  const validated = SourceConfigSchema.parse(config);

  return validated;
}

/**
 * List all available source IDs
 */
export function listSourceIds(): string[] {
  return Object.keys(SOURCE_CONFIGS);
}
