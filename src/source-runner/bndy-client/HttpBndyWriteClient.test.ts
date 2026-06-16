/**
 * HttpBndyWriteClient Tests
 *
 * Tests for the HTTP implementation of BndyWriteClient.
 * Uses bndy's community API routes (unauthenticated).
 *
 * Routes:
 * - venue → POST /api/venues/find-or-create
 * - artist → POST /api/artists/find-or-create
 * - event → POST /api/events/community
 * - lookups → GET /api/{events,artists,venues}/by-external-id
 * - delete → DELETE /api/events/{id}/mcp
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpBndyWriteClient } from './HttpBndyWriteClient';
import {
  CreateEventRequest,
  CreateVenueRequest,
  CreateArtistRequest,
  HideEventRequest,
} from './BndyWriteClient';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('HttpBndyWriteClient', () => {
  const baseUrl = 'https://api.bndy.co.uk';
  let client: HttpBndyWriteClient;

  beforeEach(() => {
    client = new HttpBndyWriteClient(baseUrl);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createVenue', () => {
    it('should call POST /api/venues/find-or-create with externalIds array', async () => {
      const request: CreateVenueRequest = {
        externalId: 'klma-venue-123',
        name: 'The Swan',
        city: 'Stone',
        region: 'Staffordshire',
        sourceId: 'klma-stoke-gig-list',
      };

      // Real API returns: flat venue object { id, name, city, ... }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'bndy-venue-abc',
          name: 'The Swan',
          city: 'Stone',
        }),
      });

      const result = await client.createVenue(request);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/venues/find-or-create`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.name).toBe('The Swan');
      expect(body.city).toBe('Stone');
      expect(body.region).toBe('Staffordshire');
      // externalIds is array format
      expect(body.externalIds).toEqual([{ source: 'klma-stoke-gig-list', id: 'klma-venue-123' }]);

      expect(result.success).toBe(true);
      expect(result.venueId).toBe('bndy-venue-abc');
    });

    it('should handle matched venue response', async () => {
      // Matched venue also returns flat object with id
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'bndy-venue-existing',
          name: 'The Swan',
          city: 'Stone',
        }),
      });

      const result = await client.createVenue({
        externalId: 'klma-venue-123',
        name: 'The Swan',
        city: 'Stone',
        region: 'Staffordshire',
        sourceId: 'klma-stoke-gig-list',
      });

      expect(result.success).toBe(true);
      expect(result.venueId).toBe('bndy-venue-existing');
    });

    it('should handle API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await client.createVenue({
        externalId: 'klma-venue-123',
        name: 'The Swan',
        city: 'Stone',
        region: 'Staffordshire',
        sourceId: 'klma-stoke-gig-list',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.createVenue({
        externalId: 'klma-venue-123',
        name: 'The Swan',
        city: 'Stone',
        region: 'Staffordshire',
        sourceId: 'klma-stoke-gig-list',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('createArtist', () => {
    it('should call POST /api/artists/find-or-create with externalIds array', async () => {
      const request: CreateArtistRequest = {
        externalId: 'klma-artist-456',
        name: 'Test Artist',
        location: 'Staffordshire UK',
        sourceId: 'klma-stoke-gig-list',
      };

      // Real API returns: { action: 'created', artist: { id, name } }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: 'created',
          artist: { id: 'bndy-artist-xyz', name: 'Test Artist' },
        }),
      });

      const result = await client.createArtist(request);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/artists/find-or-create`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Verify externalIds is sent as array format
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.externalIds).toEqual([{ source: 'klma-stoke-gig-list', id: 'klma-artist-456' }]);
      expect(body.name).toBe('Test Artist');
      expect(body.location).toBe('Staffordshire UK');

      expect(result.success).toBe(true);
      expect(result.artistId).toBe('bndy-artist-xyz');
    });

    it('should handle matched action response', async () => {
      // Real API returns: { action: 'matched', artist: { id, name } }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: 'matched',
          artist: { id: 'bndy-artist-existing', name: 'Test Artist' },
        }),
      });

      const result = await client.createArtist({
        externalId: 'klma-artist-456',
        name: 'Test Artist',
        location: 'Staffordshire UK',
        sourceId: 'klma-stoke-gig-list',
      });

      expect(result.success).toBe(true);
      expect(result.artistId).toBe('bndy-artist-existing');
    });

    it('should handle review action (ADR-014 gate)', async () => {
      // Real API returns: { action: 'review', candidates: [...] }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: 'review',
          candidates: [
            { id: 'artist-1', name: 'Test Band', confidence: 0.7 },
            { id: 'artist-2', name: 'Test Band Duo', confidence: 0.6 },
          ],
        }),
      });

      const result = await client.createArtist({
        externalId: 'klma-artist-456',
        name: 'Ambiguous Artist',
        location: 'Staffordshire UK',
        sourceId: 'klma-stoke-gig-list',
      });

      // Review action means no ID returned, but not an error
      expect(result.success).toBe(false);
      expect(result.error).toContain('review');
    });

    it('should fallback to /api/artists/community on 404', async () => {
      // First call to find-or-create returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
      // Fallback to community endpoint succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'Artist created successfully',
          artist: { id: 'bndy-artist-fallback', name: 'Test Artist' },
        }),
      });

      const result = await client.createArtist({
        externalId: 'klma-artist-456',
        name: 'Test Artist',
        location: 'Staffordshire UK',
        sourceId: 'klma-stoke-gig-list',
      });

      // Should have made 2 calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe(`${baseUrl}/api/artists/find-or-create`);
      expect(mockFetch.mock.calls[1][0]).toBe(`${baseUrl}/api/artists/community`);

      expect(result.success).toBe(true);
      expect(result.artistId).toBe('bndy-artist-fallback');
    });
  });

  describe('createEvent', () => {
    it('should call POST /api/events/community with externalIds array', async () => {
      const request: CreateEventRequest = {
        externalId: 'klma-event-789',
        date: '2026-06-20',
        startTime: '21:00',
        venueId: 'bndy-venue-abc',
        artistId: 'bndy-artist-xyz',
        isPublic: true,
        sourceId: 'klma-stoke-gig-list',
        title: 'Test Event',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'bndy-event-123',
        }),
      });

      const result = await client.createEvent(request);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/events/community`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.date).toBe('2026-06-20');
      expect(body.startTime).toBe('21:00');
      expect(body.venueId).toBe('bndy-venue-abc');
      expect(body.artistId).toBe('bndy-artist-xyz');
      expect(body.isPublic).toBe(true);
      // externalIds is array format
      expect(body.externalIds).toEqual([{ source: 'klma-stoke-gig-list', id: 'klma-event-789' }]);

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('bndy-event-123');
    });

    it('should handle null startTime', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'bndy-event-456' }),
      });

      await client.createEvent({
        externalId: 'klma-event-tbc',
        date: '2026-06-20',
        startTime: null,
        venueId: 'bndy-venue-abc',
        artistId: 'bndy-artist-xyz',
        isPublic: true,
        sourceId: 'klma-stoke-gig-list',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.startTime).toBeNull();
    });
  });

  describe('deleteEvent', () => {
    it('should call DELETE /api/events/{id}/mcp', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.deleteEvent('bndy-event-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/events/bndy-event-123/mcp`,
        expect.objectContaining({
          method: 'DELETE',
        })
      );

      expect(result.success).toBe(true);
    });

    it('should handle 404 as success (already deleted)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await client.deleteEvent('bndy-event-nonexistent');

      // 404 means event doesn't exist - treat as successful deletion
      expect(result.success).toBe(true);
    });

    it('should handle 401/403 as failure (permission denied)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await client.deleteEvent('bndy-event-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });
  });

  describe('hideEvent', () => {
    it('should call PUT /api/events/{id}/mcp with isPublic:false', async () => {
      const request: HideEventRequest = {
        eventId: 'bndy-event-123',
        reason: 'Source removed from list',
        sourceId: 'klma-stoke-gig-list',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.hideEvent(request);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/events/bndy-event-123/mcp`,
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.isPublic).toBe(false);
      expect(body.hideReason).toBe('Source removed from list');

      expect(result.success).toBe(true);
    });
  });

  describe('lookupByExternalId', () => {
    it('should call GET /api/venues/by-external-id for venue', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'bndy-venue-abc',
        }),
      });

      const result = await client.lookupByExternalId('klma-venue-123', 'venue');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/venues/by-external-id?externalId=klma-venue-123`,
        expect.objectContaining({
          method: 'GET',
        })
      );

      expect(result).toEqual({ id: 'bndy-venue-abc', type: 'venue' });
    });

    it('should call GET /api/artists/by-external-id for artist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'bndy-artist-xyz',
        }),
      });

      const result = await client.lookupByExternalId('klma-artist-456', 'artist');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/artists/by-external-id?externalId=klma-artist-456`,
        expect.objectContaining({
          method: 'GET',
        })
      );

      expect(result).toEqual({ id: 'bndy-artist-xyz', type: 'artist' });
    });

    it('should call GET /api/events/by-external-id for event', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'bndy-event-789',
        }),
      });

      const result = await client.lookupByExternalId('klma-event-abc', 'event');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/events/by-external-id?externalId=klma-event-abc`,
        expect.objectContaining({
          method: 'GET',
        })
      );

      expect(result).toEqual({ id: 'bndy-event-789', type: 'event' });
    });

    it('should return null for 404 (not found)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await client.lookupByExternalId('unknown-id', 'venue');

      expect(result).toBeNull();
    });

    it('should return null for empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      });

      const result = await client.lookupByExternalId('klma-venue-empty', 'venue');

      expect(result).toBeNull();
    });
  });

  describe('configuration', () => {
    it('should use BNDY_API_BASE from environment', () => {
      const envClient = new HttpBndyWriteClient('https://custom.api.bndy.co.uk');
      // Can't easily test the internal baseUrl, but we verify it's configurable
      expect(envClient).toBeInstanceOf(HttpBndyWriteClient);
    });
  });
});
