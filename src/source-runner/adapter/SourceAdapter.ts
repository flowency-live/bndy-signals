/**
 * SourceAdapter Interface
 *
 * ADR-014: Formalise a SourceAdapter interface for source-specific operations.
 *
 * The runner depends on this interface; each source (KLMA, future website/paste sources)
 * implements it. "Add a website source" = implement adapter + register, nothing in the
 * generic layer changes.
 *
 * The contract is:
 * - fetch: Download raw data (CSV, HTML, API response, etc.)
 * - parse: Transform raw data into NormalisedEvent[] + ParkingLotItem[]
 *
 * Everything downstream (diff, resolution, write, report) consumes NormalisedEvent[]
 * and is source-agnostic.
 */

import { SourceConfig, SourceRun } from '../types';
import { FetchedSource, ParsedSource } from '../runner';

/**
 * Source adapter interface.
 * Each source type (CSV, HTML, API, paste) implements this.
 */
export interface SourceAdapter {
  /**
   * Fetch raw data from the source.
   * @param config Source configuration
   * @param run Current run metadata
   * @returns Raw fetched data (CSV body, HTML, JSON, etc.)
   */
  fetch(config: SourceConfig, run: SourceRun): Promise<FetchedSource>;

  /**
   * Parse raw data into normalised events.
   * Includes normalisation step - raw → parsed → normalised is combined.
   * @param config Source configuration
   * @param run Current run metadata
   * @param raw Raw fetched data
   * @returns Normalised events and parked items
   */
  parse(config: SourceConfig, run: SourceRun, raw: FetchedSource): Promise<ParsedSource>;
}

// Registry: sourceId -> adapter
const adapterRegistry = new Map<string, SourceAdapter>();

/**
 * Register a source adapter.
 * @param sourceId The source identifier
 * @param adapter The adapter implementation
 */
export function registerSourceAdapter(sourceId: string, adapter: SourceAdapter): void {
  adapterRegistry.set(sourceId, adapter);
}

/**
 * Get the adapter for a source.
 * @param sourceId The source identifier
 * @returns The adapter, or undefined if not registered
 */
export function getSourceAdapter(sourceId: string): SourceAdapter | undefined {
  return adapterRegistry.get(sourceId);
}

/**
 * Clear all registered adapters (for testing).
 */
export function clearAdapterRegistry(): void {
  adapterRegistry.clear();
}
