/**
 * HttpBndyWriteClient
 *
 * HTTP implementation of BndyWriteClient for calling bndy's community API.
 * Uses unauthenticated community routes.
 *
 * Routes:
 * - venue → POST /api/venues/find-or-create (unauthenticated, flat response)
 * - artist → POST /api/artists/find-or-create
 * - event → POST /api/events/community
 * - lookups → GET /api/{events,artists,venues}/by-external-id
 * - delete → DELETE /api/events/{id}/mcp
 * - hide → PUT /api/events/{id}/mcp with isPublic:false
 *
 * API Contract:
 * - externalIds: [{source, id}] array format (not externalId string)
 * - artist response: {action: 'matched'|'review'|'created', artist:{id,name}}
 * - venue response: {id, name, ...} flat object (not wrapped)
 *
 * Note: /api/integration/venues requires x-api-key; use find-or-create for now.
 */

// API response types for type-safe JSON parsing
interface VenueResponse {
  id: string;
  name?: string;
  city?: string;
}

interface ArtistFindOrCreateResponse {
  action: 'matched' | 'review' | 'created';
  artist?: { id: string; name: string };
  candidates?: Array<{ id: string; name: string; confidence: number }>;
}

interface ArtistCommunityResponse {
  message?: string;
  artist?: { id: string; name: string };
}

interface EventResponse {
  id: string;
}

interface LookupResponse {
  id?: string;
}

import {
  BndyWriteClient,
  CreateEventRequest,
  CreateEventResult,
  CreateVenueRequest,
  CreateVenueResult,
  CreateArtistRequest,
  CreateArtistResult,
  DeleteEventResult,
  HideEventRequest,
  HideEventResult,
  EntityLookupResult,
} from './BndyWriteClient';

export class HttpBndyWriteClient implements BndyWriteClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Create or find a venue via POST /api/venues/find-or-create
   * Unauthenticated route - returns flat venue object {id, name, ...}
   * Uses externalIds array format: [{source, id}]
   *
   * Note: /api/integration/venues has server-side geocode but requires x-api-key.
   * Use this unauthenticated route for KLMA; integration route for future web feeds.
   */
  async createVenue(request: CreateVenueRequest): Promise<CreateVenueResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/venues/find-or-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: request.name,
          city: request.city,
          region: request.region,
          externalIds: [{ source: request.sourceId, id: request.externalId }],
          placeId: request.placeId,
          // ADR-021: Pass canCreate so server knows whether to create or return review
          canCreate: request.canCreate,
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Response: flat venue object { id, name, city, ... }
      // OR { action: 'review', reason: '...' } when canCreate=false and no match
      const data = (await response.json()) as VenueResponse & { action?: string };

      // ADR-021: Handle review action (canCreate=false, no match found)
      if (data.action === 'review') {
        return {
          success: false,
          error: 'Venue requires review: no match found',
        };
      }

      return {
        success: true,
        venueId: data.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create or find an artist via POST /api/artists/find-or-create
   * ADR-014 gate: server may return action: 'review' for ambiguous matches.
   * Uses externalIds array format: [{source, id}]
   * Uses location field (not region) for artist location.
   *
   * Falls back to /api/artists/community if find-or-create returns 404
   * (matches MCP server behavior for deployments where route isn't available).
   */
  async createArtist(request: CreateArtistRequest): Promise<CreateArtistResult> {
    const artistData = {
      name: request.name,
      location: request.location,
      externalIds: [{ source: request.sourceId, id: request.externalId }],
      artistType: request.artistType,
      // ADR-021 rev.3: venueRegion enables footprint scoring to disambiguate same-name artists
      venueRegion: request.venueRegion,
      // ADR-021: Pass canCreate so server knows whether to create or return review
      canCreate: request.canCreate,
    };

    try {
      // Try find-or-create first (ADR-014 resolution gate)
      const response = await fetch(`${this.baseUrl}/api/artists/find-or-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(artistData),
      });

      // Fallback to /api/artists/community on 404 (route not deployed)
      if (response.status === 404) {
        return this.createArtistCommunityFallback(artistData);
      }

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Response: { action: 'matched'|'review'|'created', artist: { id, name }, candidates?: [...] }
      const data = (await response.json()) as ArtistFindOrCreateResponse;

      // Handle ADR-014 review gate
      if (data.action === 'review') {
        return {
          success: false,
          error: `Artist requires review: ambiguous match`,
        };
      }

      return {
        success: true,
        artistId: data.artist?.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fallback artist creation via /api/artists/community
   * Used when /api/artists/find-or-create is not deployed (404).
   * This route always creates (no dedup) - use with caution.
   */
  private async createArtistCommunityFallback(
    artistData: Record<string, unknown>
  ): Promise<CreateArtistResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/artists/community`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(artistData),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText} (community fallback)`,
        };
      }

      // Response: { message: '...', artist: { id, name, ... } }
      const data = (await response.json()) as ArtistCommunityResponse;
      return {
        success: true,
        artistId: data.artist?.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a community event via POST /api/events/community
   * Uses externalIds array format: [{source, id}]
   */
  async createEvent(request: CreateEventRequest): Promise<CreateEventResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/events/community`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalIds: [{ source: request.sourceId, id: request.externalId }],
          source: request.sourceId, // Explicit source field for events-lambda
          date: request.date,
          startTime: request.startTime,
          venueId: request.venueId,
          artistId: request.artistId,
          isPublic: request.isPublic,
          title: request.title,
          eventUrl: request.eventUrl,
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = (await response.json()) as EventResponse;
      return {
        success: true,
        eventId: data.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete an event via DELETE /api/events/{id}/mcp
   * Treats 404 as success (event already gone).
   */
  async deleteEvent(eventId: string): Promise<DeleteEventResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/events/${eventId}/mcp`, {
        method: 'DELETE',
      });

      // 404 means event doesn't exist - treat as success
      if (response.status === 404) {
        return { success: true };
      }

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Hide an event via PUT /api/events/{id}/mcp with isPublic:false
   * Used as fallback when delete fails (permission denied).
   */
  async hideEvent(request: HideEventRequest): Promise<HideEventResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/events/${request.eventId}/mcp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPublic: false,
          hideReason: request.reason,
          hiddenBySource: request.sourceId,
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Look up an entity by external ID via GET /api/{type}/by-external-id
   */
  async lookupByExternalId(
    externalId: string,
    type: 'venue' | 'artist' | 'event'
  ): Promise<EntityLookupResult | null> {
    try {
      const typeRoute = type === 'venue' ? 'venues' : type === 'artist' ? 'artists' : 'events';
      const url = `${this.baseUrl}/api/${typeRoute}/by-external-id?externalId=${encodeURIComponent(externalId)}`;

      const response = await fetch(url, {
        method: 'GET',
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as LookupResponse | null;

      if (!data || !data.id) {
        return null;
      }

      return {
        id: data.id,
        type,
      };
    } catch {
      return null;
    }
  }
}
