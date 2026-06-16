/**
 * BndyWriteClient Tests
 *
 * Tests for the bndy write client interface and mock implementation.
 * Mock-first approach per ADR-015: all operations runnable with zero live API.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockBndyWriteClient,
  BndyWriteClient,
  CreateEventRequest,
  CreateVenueRequest,
  CreateArtistRequest,
  HideEventRequest,
} from './BndyWriteClient';

describe('MockBndyWriteClient', () => {
  let client: MockBndyWriteClient;

  beforeEach(() => {
    client = new MockBndyWriteClient();
  });

  describe('interface compliance', () => {
    it('should implement BndyWriteClient interface', () => {
      // Type check - if this compiles, the interface is correct
      const _: BndyWriteClient = client;
      expect(client).toBeDefined();
    });
  });

  describe('createEvent', () => {
    it('should record event creation', async () => {
      const request: CreateEventRequest = {
        externalId: 'klma-abc123',
        date: '2026-06-20',
        startTime: '21:00',
        venueId: 'venue-123',
        artistId: 'artist-456',
        isPublic: true,
        sourceId: 'klma-stoke-gig-list',
      };

      const result = await client.createEvent(request);

      expect(result.success).toBe(true);
      expect(result.eventId).toBeDefined();
      expect(client.getRecordedOperations()).toContainEqual({
        type: 'createEvent',
        request,
        result,
      });
    });

    it('should respect isPublic flag', async () => {
      const privateRequest: CreateEventRequest = {
        externalId: 'klma-private',
        date: '2026-06-20',
        startTime: '21:00',
        venueId: 'venue-123',
        artistId: 'artist-456',
        isPublic: false,
        sourceId: 'klma-stoke-gig-list',
      };

      const result = await client.createEvent(privateRequest);

      expect(result.success).toBe(true);
      // Verify the request was recorded with isPublic: false
      const ops = client.getRecordedOperations();
      expect(ops[0].request.isPublic).toBe(false);
    });

    it('should generate unique event IDs', async () => {
      const request1: CreateEventRequest = {
        externalId: 'klma-1',
        date: '2026-06-20',
        startTime: '21:00',
        venueId: 'venue-123',
        artistId: 'artist-456',
        isPublic: true,
        sourceId: 'klma-stoke-gig-list',
      };
      const request2: CreateEventRequest = {
        externalId: 'klma-2',
        date: '2026-06-21',
        startTime: '21:00',
        venueId: 'venue-123',
        artistId: 'artist-789',
        isPublic: true,
        sourceId: 'klma-stoke-gig-list',
      };

      const result1 = await client.createEvent(request1);
      const result2 = await client.createEvent(request2);

      expect(result1.eventId).not.toBe(result2.eventId);
    });
  });

  describe('createVenue', () => {
    it('should record venue creation', async () => {
      const request: CreateVenueRequest = {
        externalId: 'klma-venue-abc123',
        name: 'The Swan, Stone',
        city: 'Stone',
        region: 'Staffordshire',
        sourceId: 'klma-stoke-gig-list',
      };

      const result = await client.createVenue(request);

      expect(result.success).toBe(true);
      expect(result.venueId).toBeDefined();
      expect(client.getRecordedOperations()).toContainEqual({
        type: 'createVenue',
        request,
        result,
      });
    });
  });

  describe('createArtist', () => {
    it('should record artist creation', async () => {
      const request: CreateArtistRequest = {
        externalId: 'klma-artist-abc123',
        name: 'Test Artist',
        location: 'Staffordshire UK',
        sourceId: 'klma-stoke-gig-list',
      };

      const result = await client.createArtist(request);

      expect(result.success).toBe(true);
      expect(result.artistId).toBeDefined();
      expect(client.getRecordedOperations()).toContainEqual({
        type: 'createArtist',
        request,
        result,
      });
    });
  });

  describe('deleteEvent', () => {
    it('should record successful deletion', async () => {
      const eventId = 'event-to-delete';

      const result = await client.deleteEvent(eventId);

      expect(result.success).toBe(true);
      expect(client.getRecordedOperations()).toContainEqual({
        type: 'deleteEvent',
        eventId,
        result,
      });
    });

    it('should return failure when configured to fail', async () => {
      client.setDeleteBehavior('fail');
      const eventId = 'event-to-delete';

      const result = await client.deleteEvent(eventId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('hideEvent (delete fallback)', () => {
    it('should record hide operation', async () => {
      const request: HideEventRequest = {
        eventId: 'event-to-hide',
        reason: 'delete_failed',
        sourceId: 'klma-stoke-gig-list',
      };

      const result = await client.hideEvent(request);

      expect(result.success).toBe(true);
      expect(client.getRecordedOperations()).toContainEqual({
        type: 'hideEvent',
        request,
        result,
      });
    });
  });

  describe('lookupByExternalId', () => {
    it('should return null for unknown external ID', async () => {
      const result = await client.lookupByExternalId('klma-unknown', 'event');

      expect(result).toBeNull();
    });

    it('should return entity for known external ID', async () => {
      // Pre-seed the mock with a known mapping
      client.seedExternalIdMapping('klma-known', 'event', 'event-123');

      const result = await client.lookupByExternalId('klma-known', 'event');

      expect(result).toEqual({ id: 'event-123', type: 'event' });
    });
  });

  describe('operation tracking', () => {
    it('should track all operations in order', async () => {
      await client.createVenue({
        externalId: 'v1',
        name: 'Venue 1',
        city: 'City',
        region: 'Region',
        sourceId: 'source',
      });
      await client.createArtist({
        externalId: 'a1',
        name: 'Artist 1',
        location: 'Region',
        sourceId: 'source',
      });
      await client.createEvent({
        externalId: 'e1',
        date: '2026-06-20',
        startTime: '21:00',
        venueId: 'venue-1',
        artistId: 'artist-1',
        isPublic: true,
        sourceId: 'source',
      });

      const ops = client.getRecordedOperations();

      expect(ops).toHaveLength(3);
      expect(ops[0].type).toBe('createVenue');
      expect(ops[1].type).toBe('createArtist');
      expect(ops[2].type).toBe('createEvent');
    });

    it('should clear operations on reset', async () => {
      await client.createEvent({
        externalId: 'e1',
        date: '2026-06-20',
        startTime: '21:00',
        venueId: 'v1',
        artistId: 'a1',
        isPublic: true,
        sourceId: 'source',
      });

      client.reset();

      expect(client.getRecordedOperations()).toHaveLength(0);
    });
  });

  describe('counts', () => {
    it('should track operation counts', async () => {
      await client.createVenue({
        externalId: 'v1',
        name: 'V1',
        city: 'C',
        region: 'R',
        sourceId: 's',
      });
      await client.createVenue({
        externalId: 'v2',
        name: 'V2',
        city: 'C',
        region: 'R',
        sourceId: 's',
      });
      await client.createArtist({
        externalId: 'a1',
        name: 'A1',
        location: 'R',
        sourceId: 's',
      });
      await client.createEvent({
        externalId: 'e1',
        date: '2026-06-20',
        startTime: '21:00',
        venueId: 'v1',
        artistId: 'a1',
        isPublic: true,
        sourceId: 's',
      });
      await client.deleteEvent('e2');

      const counts = client.getCounts();

      expect(counts.venuesCreated).toBe(2);
      expect(counts.artistsCreated).toBe(1);
      expect(counts.eventsCreated).toBe(1);
      expect(counts.eventsDeleted).toBe(1);
    });
  });
});

describe('isPublic guard', () => {
  it('should create private events when isPublic is false', async () => {
    const client = new MockBndyWriteClient();

    const result = await client.createEvent({
      externalId: 'e1',
      date: '2026-06-20',
      startTime: '21:00',
      venueId: 'v1',
      artistId: 'a1',
      isPublic: false,
      sourceId: 'klma',
    });

    expect(result.success).toBe(true);
    const ops = client.getRecordedOperations();
    expect(ops[0].request.isPublic).toBe(false);
  });
});

describe('delete→hide fallback', () => {
  it('should hide event when delete fails', async () => {
    const client = new MockBndyWriteClient();
    client.setDeleteBehavior('fail');

    // Attempt delete
    const deleteResult = await client.deleteEvent('event-123');
    expect(deleteResult.success).toBe(false);

    // Fallback to hide
    const hideResult = await client.hideEvent({
      eventId: 'event-123',
      reason: 'delete_failed',
      sourceId: 'klma',
    });

    expect(hideResult.success).toBe(true);
    expect(client.getCounts().eventsHidden).toBe(1);
  });
});
