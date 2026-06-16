/**
 * SourceStateStore - Per-source state cache for resolution idempotency
 *
 * Keyed on the runner's OWN canonical key (slugNormalise), not the bndy name.
 * This is what makes re-runs cheap and dedupe-safe.
 *
 * Local store: data/state/{sourceId}.json
 * AWS: DynamoDB bndy-source-state-{env}
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ResolutionMethod =
  | 'state'       // Hit from this cache
  | 'external_id' // Hit from bndy external ID lookup
  | 'place_id'    // Hit from Google Place ID
  | 'name_town'   // Matched by name + town corroboration
  | 'token'       // Fuzzy token match
  | 'review'      // Resolved via manual review
  | 'created';    // Created new entity

export interface SourceStateEntry {
  sourceCanonicalKey: string;   // slugNormalise(runner's canonicalName)
  entityType: 'venue' | 'artist';
  bndyId: string;               // Opaque string (UUID + Firestore coexist)
  method: ResolutionMethod;
  confidence: number;
  sourceExternalIds: string[];  // Source external-ids attached on the entity
  googlePlaceId?: string;       // Venues only
  firstSeenAt: string;
  lastSeenAt: string;
}

// -----------------------------------------------------------------------------
// Interface
// -----------------------------------------------------------------------------

export interface SourceStateStore {
  /**
   * Get a state entry by source canonical key.
   */
  get(
    sourceId: string,
    entityType: 'venue' | 'artist',
    sourceCanonicalKey: string
  ): Promise<SourceStateEntry | null>;

  /**
   * Set/update a state entry.
   */
  set(sourceId: string, entry: SourceStateEntry): Promise<void>;

  /**
   * Add an external ID to an existing entry.
   */
  addExternalId(
    sourceId: string,
    entityType: 'venue' | 'artist',
    sourceCanonicalKey: string,
    externalId: string
  ): Promise<void>;

  /**
   * Get all entries for a source.
   */
  getAllForSource(sourceId: string): Promise<SourceStateEntry[]>;
}

// -----------------------------------------------------------------------------
// InMemorySourceStateStore
// -----------------------------------------------------------------------------

/**
 * In-memory implementation for testing and dry-run mode.
 */
export class InMemorySourceStateStore implements SourceStateStore {
  // Map: sourceId -> Map<compositeKey, entry>
  private stores: Map<string, Map<string, SourceStateEntry>> = new Map();

  private makeKey(entityType: 'venue' | 'artist', sourceCanonicalKey: string): string {
    return `${entityType}:${sourceCanonicalKey}`;
  }

  private getSourceStore(sourceId: string): Map<string, SourceStateEntry> {
    let store = this.stores.get(sourceId);
    if (!store) {
      store = new Map();
      this.stores.set(sourceId, store);
    }
    return store;
  }

  async get(
    sourceId: string,
    entityType: 'venue' | 'artist',
    sourceCanonicalKey: string
  ): Promise<SourceStateEntry | null> {
    const store = this.getSourceStore(sourceId);
    const key = this.makeKey(entityType, sourceCanonicalKey);
    return store.get(key) || null;
  }

  async set(sourceId: string, entry: SourceStateEntry): Promise<void> {
    const store = this.getSourceStore(sourceId);
    const key = this.makeKey(entry.entityType, entry.sourceCanonicalKey);
    store.set(key, { ...entry });
  }

  async addExternalId(
    sourceId: string,
    entityType: 'venue' | 'artist',
    sourceCanonicalKey: string,
    externalId: string
  ): Promise<void> {
    const entry = await this.get(sourceId, entityType, sourceCanonicalKey);
    if (entry && !entry.sourceExternalIds.includes(externalId)) {
      entry.sourceExternalIds.push(externalId);
      await this.set(sourceId, entry);
    }
  }

  async getAllForSource(sourceId: string): Promise<SourceStateEntry[]> {
    const store = this.getSourceStore(sourceId);
    return Array.from(store.values());
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.stores.clear();
  }
}
