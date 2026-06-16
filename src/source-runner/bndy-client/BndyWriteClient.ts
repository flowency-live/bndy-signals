/**
 * BndyWriteClient Interface and Mock Implementation
 *
 * ADR-015: Mock-first approach - all operations runnable with zero live API.
 *
 * The BndyWriteClient provides the interface for writing to bndy.
 * MockBndyWriteClient records all operations for testing and dry-run mode.
 * HttpBndyWriteClient (Epic 4b) will implement the real API calls.
 */

// -----------------------------------------------------------------------------
// Request/Response Types
// -----------------------------------------------------------------------------

export interface CreateEventRequest {
  externalId: string;
  date: string;
  startTime: string | null;
  venueId: string;
  artistId: string;
  isPublic: boolean;
  sourceId: string;
  title?: string;
  eventUrl?: string;
}

export interface CreateEventResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

export interface CreateVenueRequest {
  externalId: string;
  name: string;
  city: string;
  region: string;
  sourceId: string;
  placeId?: string;
  /**
   * Whether to create new entities on no-match (ADR-021).
   * When false, server returns review instead of creating.
   * Default: true (backwards compatible with existing routes).
   */
  canCreate?: boolean;
}

export interface CreateVenueResult {
  success: boolean;
  venueId?: string;
  error?: string;
}

export interface CreateArtistRequest {
  externalId: string;
  name: string;
  /** Location string (e.g. "Staffordshire UK") - API field name is 'location' not 'region' */
  location: string;
  sourceId: string;
  artistType?: string;
  /**
   * Venue region for footprint scoring (ADR-021 rev.3).
   * When provided, enables multi-signal scoring to disambiguate same-name artists
   * by their gig-geography footprint. Without this, falls back to name-based matching.
   */
  venueRegion?: string;
  /**
   * Whether to create new entities on no-match (ADR-021).
   * When false, server returns review instead of creating.
   * Default: true (backwards compatible with existing routes).
   */
  canCreate?: boolean;
}

export interface CreateArtistResult {
  success: boolean;
  artistId?: string;
  error?: string;
}

export interface DeleteEventResult {
  success: boolean;
  error?: string;
}

export interface HideEventRequest {
  eventId: string;
  reason: string;
  sourceId: string;
}

export interface HideEventResult {
  success: boolean;
  error?: string;
}

export interface EntityLookupResult {
  id: string;
  type: 'venue' | 'artist' | 'event';
}

// -----------------------------------------------------------------------------
// BndyWriteClient Interface
// -----------------------------------------------------------------------------

export interface BndyWriteClient {
  createEvent(request: CreateEventRequest): Promise<CreateEventResult>;
  createVenue(request: CreateVenueRequest): Promise<CreateVenueResult>;
  createArtist(request: CreateArtistRequest): Promise<CreateArtistResult>;
  deleteEvent(eventId: string): Promise<DeleteEventResult>;
  hideEvent(request: HideEventRequest): Promise<HideEventResult>;
  lookupByExternalId(
    externalId: string,
    type: 'venue' | 'artist' | 'event'
  ): Promise<EntityLookupResult | null>;
}

// -----------------------------------------------------------------------------
// Recorded Operation Types
// -----------------------------------------------------------------------------

export type RecordedOperation =
  | { type: 'createEvent'; request: CreateEventRequest; result: CreateEventResult }
  | { type: 'createVenue'; request: CreateVenueRequest; result: CreateVenueResult }
  | { type: 'createArtist'; request: CreateArtistRequest; result: CreateArtistResult }
  | { type: 'deleteEvent'; eventId: string; result: DeleteEventResult }
  | { type: 'hideEvent'; request: HideEventRequest; result: HideEventResult };

export interface OperationCounts {
  eventsCreated: number;
  eventsDeleted: number;
  eventsHidden: number;
  venuesCreated: number;
  artistsCreated: number;
}

// -----------------------------------------------------------------------------
// MockBndyWriteClient
// -----------------------------------------------------------------------------

export class MockBndyWriteClient implements BndyWriteClient {
  private operations: RecordedOperation[] = [];
  private externalIdMappings: Map<string, EntityLookupResult> = new Map();
  private idCounter = 0;
  private deleteBehavior: 'succeed' | 'fail' = 'succeed';
  private venueCreateBehavior: 'succeed' | 'fail' = 'succeed';
  private artistCreateBehavior: 'succeed' | 'fail' = 'succeed';

  /**
   * Create a new event in bndy.
   * Records the operation and returns a generated event ID.
   */
  async createEvent(request: CreateEventRequest): Promise<CreateEventResult> {
    const eventId = this.generateId('event');
    const result: CreateEventResult = {
      success: true,
      eventId,
    };

    this.operations.push({ type: 'createEvent', request, result });

    // Store the mapping for future lookups
    this.externalIdMappings.set(`${request.externalId}:event`, {
      id: eventId,
      type: 'event',
    });

    return result;
  }

  /**
   * Create a new venue in bndy.
   * Behavior can be configured via setVenueCreateBehavior() for testing.
   */
  async createVenue(request: CreateVenueRequest): Promise<CreateVenueResult> {
    if (this.venueCreateBehavior === 'fail') {
      const result: CreateVenueResult = {
        success: false,
        error: 'Venue creation failed (mock)',
      };
      this.operations.push({ type: 'createVenue', request, result });
      return result;
    }

    const venueId = this.generateId('venue');
    const result: CreateVenueResult = {
      success: true,
      venueId,
    };

    this.operations.push({ type: 'createVenue', request, result });

    this.externalIdMappings.set(`${request.externalId}:venue`, {
      id: venueId,
      type: 'venue',
    });

    return result;
  }

  /**
   * Create a new artist in bndy.
   * Behavior can be configured via setArtistCreateBehavior() for testing.
   */
  async createArtist(request: CreateArtistRequest): Promise<CreateArtistResult> {
    if (this.artistCreateBehavior === 'fail') {
      const result: CreateArtistResult = {
        success: false,
        error: 'Artist creation failed (mock)',
      };
      this.operations.push({ type: 'createArtist', request, result });
      return result;
    }

    const artistId = this.generateId('artist');
    const result: CreateArtistResult = {
      success: true,
      artistId,
    };

    this.operations.push({ type: 'createArtist', request, result });

    this.externalIdMappings.set(`${request.externalId}:artist`, {
      id: artistId,
      type: 'artist',
    });

    return result;
  }

  /**
   * Delete an event from bndy.
   * Behavior can be configured via setDeleteBehavior() for testing.
   */
  async deleteEvent(eventId: string): Promise<DeleteEventResult> {
    const result: DeleteEventResult =
      this.deleteBehavior === 'succeed'
        ? { success: true }
        : { success: false, error: 'Delete failed (mock)' };

    this.operations.push({ type: 'deleteEvent', eventId, result });

    return result;
  }

  /**
   * Hide an event (fallback when delete fails).
   * Per spec: delete→hide behavior creates a review item.
   */
  async hideEvent(request: HideEventRequest): Promise<HideEventResult> {
    const result: HideEventResult = { success: true };

    this.operations.push({ type: 'hideEvent', request, result });

    return result;
  }

  /**
   * Look up an entity by its external ID.
   */
  async lookupByExternalId(
    externalId: string,
    type: 'venue' | 'artist' | 'event'
  ): Promise<EntityLookupResult | null> {
    const key = `${externalId}:${type}`;
    return this.externalIdMappings.get(key) || null;
  }

  // ---------------------------------------------------------------------------
  // Mock Control Methods
  // ---------------------------------------------------------------------------

  /**
   * Configure delete behavior for testing delete→hide fallback.
   */
  setDeleteBehavior(behavior: 'succeed' | 'fail'): void {
    this.deleteBehavior = behavior;
  }

  /**
   * Configure venue creation behavior for testing.
   */
  setVenueCreateBehavior(behavior: 'succeed' | 'fail'): void {
    this.venueCreateBehavior = behavior;
  }

  /**
   * Configure artist creation behavior for testing.
   */
  setArtistCreateBehavior(behavior: 'succeed' | 'fail'): void {
    this.artistCreateBehavior = behavior;
  }

  /**
   * Pre-seed an external ID mapping for testing lookups.
   */
  seedExternalIdMapping(
    externalId: string,
    type: 'venue' | 'artist' | 'event',
    entityId: string
  ): void {
    this.externalIdMappings.set(`${externalId}:${type}`, { id: entityId, type });
  }

  /**
   * Get all recorded operations.
   */
  getRecordedOperations(): RecordedOperation[] {
    return [...this.operations];
  }

  /**
   * Get operation counts for reporting.
   */
  getCounts(): OperationCounts {
    let eventsCreated = 0;
    let eventsDeleted = 0;
    let eventsHidden = 0;
    let venuesCreated = 0;
    let artistsCreated = 0;

    for (const op of this.operations) {
      switch (op.type) {
        case 'createEvent':
          if (op.result.success) eventsCreated++;
          break;
        case 'deleteEvent':
          if (op.result.success) eventsDeleted++;
          break;
        case 'hideEvent':
          if (op.result.success) eventsHidden++;
          break;
        case 'createVenue':
          if (op.result.success) venuesCreated++;
          break;
        case 'createArtist':
          if (op.result.success) artistsCreated++;
          break;
      }
    }

    return {
      eventsCreated,
      eventsDeleted,
      eventsHidden,
      venuesCreated,
      artistsCreated,
    };
  }

  /**
   * Reset all recorded state.
   */
  reset(): void {
    this.operations = [];
    this.externalIdMappings.clear();
    this.idCounter = 0;
    this.deleteBehavior = 'succeed';
    this.venueCreateBehavior = 'succeed';
    this.artistCreateBehavior = 'succeed';
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private generateId(prefix: string): string {
    this.idCounter++;
    return `mock-${prefix}-${this.idCounter}`;
  }
}
