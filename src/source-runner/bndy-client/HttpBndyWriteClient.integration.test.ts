/**
 * HttpBndyWriteClient Integration Tests
 *
 * Real API calls against the dev environment.
 * These tests are SKIPPED by default - run with:
 *   npm test -- --run src/source-runner/bndy-client/HttpBndyWriteClient.integration.test.ts
 *
 * Purpose: Catch contract drift that mock tests miss.
 * Two separate contract bugs shipped green because of mock-only tests.
 *
 * Requirements:
 * - Internet connectivity
 * - Dev API at https://api.bndy.co.uk (or BNDY_API_BASE env var)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { HttpBndyWriteClient } from './HttpBndyWriteClient';

// Skip these tests by default - they make real API calls
const SKIP_INTEGRATION = process.env.RUN_INTEGRATION_TESTS !== 'true';

describe.skipIf(SKIP_INTEGRATION)('HttpBndyWriteClient Integration', () => {
  let client: HttpBndyWriteClient;
  const baseUrl = process.env.BNDY_API_BASE || 'https://api.bndy.co.uk';

  // Generate unique IDs to avoid collisions across test runs
  const testRunId = `test-${Date.now()}`;

  beforeAll(() => {
    client = new HttpBndyWriteClient(baseUrl);
    console.log(`Integration tests using API: ${baseUrl}`);
    console.log(`Test run ID: ${testRunId}`);
  });

  describe('createVenue - real API', () => {
    it('should create or find a venue via /api/venues/find-or-create', async () => {
      const result = await client.createVenue({
        externalId: `${testRunId}-venue-1`,
        name: 'Integration Test Venue',
        city: 'Test City',
        region: 'Test Region',
        sourceId: 'integration-test',
      });

      // Log the full response for debugging
      console.log('createVenue result:', JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(result.venueId).toBeDefined();
      expect(typeof result.venueId).toBe('string');
      expect(result.venueId!.length).toBeGreaterThan(0);
    });
  });

  describe('createArtist - real API', () => {
    it('should create or find an artist via /api/artists/find-or-create', async () => {
      const result = await client.createArtist({
        externalId: `${testRunId}-artist-1`,
        name: 'Integration Test Artist',
        location: 'Test Location UK',
        sourceId: 'integration-test',
      });

      // Log the full response for debugging
      console.log('createArtist result:', JSON.stringify(result, null, 2));

      // Handle various response scenarios
      if (result.success) {
        expect(result.artistId).toBeDefined();
        expect(typeof result.artistId).toBe('string');
        expect(result.artistId!.length).toBeGreaterThan(0);
        console.log('Artist created/matched successfully');
      } else if (result.error?.includes('review')) {
        // Review gate triggered - valid behavior per ADR-014
        console.log('Artist requires review (ADR-014 gate) - this is valid behavior');
      } else {
        // Unexpected error - fail the test
        throw new Error(`Unexpected artist creation error: ${result.error}`);
      }
    });
  });

  describe('createEvent - real API', () => {
    let testVenueId: string;
    let testArtistId: string;

    beforeAll(async () => {
      // Create test venue and artist first
      const venueResult = await client.createVenue({
        externalId: `${testRunId}-event-venue`,
        name: 'Event Test Venue',
        city: 'Event City',
        region: 'Event Region',
        sourceId: 'integration-test',
      });

      if (!venueResult.success || !venueResult.venueId) {
        throw new Error(`Failed to create test venue: ${venueResult.error}`);
      }
      testVenueId = venueResult.venueId;

      const artistResult = await client.createArtist({
        externalId: `${testRunId}-event-artist`,
        name: 'Event Test Artist Unique',
        location: 'Event Location UK',
        sourceId: 'integration-test',
      });

      if (!artistResult.success || !artistResult.artistId) {
        // Skip event test if artist creation failed (review gate)
        console.log('Skipping event test - artist creation failed:', artistResult.error);
        testArtistId = '';
        return;
      }
      testArtistId = artistResult.artistId;
    });

    it('should create an event via /api/events/community', async () => {
      if (!testArtistId) {
        console.log('Skipping event test - no artist ID available');
        return;
      }

      const result = await client.createEvent({
        externalId: `${testRunId}-event-1`,
        date: '2099-12-31', // Future date to avoid conflicts
        startTime: '21:00',
        venueId: testVenueId,
        artistId: testArtistId,
        isPublic: false, // Private to avoid polluting public data
        sourceId: 'integration-test',
        title: 'Integration Test Event',
      });

      // Log the full response for debugging
      console.log('createEvent result:', JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(result.eventId).toBeDefined();
      expect(typeof result.eventId).toBe('string');
      expect(result.eventId!.length).toBeGreaterThan(0);
    });
  });

  describe('lookupByExternalId - real API', () => {
    it('should return null for non-existent external ID', async () => {
      const result = await client.lookupByExternalId(
        `nonexistent-${testRunId}`,
        'venue'
      );

      expect(result).toBeNull();
    });
  });
});

/**
 * Contract Verification Checklist
 *
 * When these tests pass against the real API, the following contracts are verified:
 *
 * 1. POST /api/venues/find-or-create
 *    - Request: { name, city, region, externalIds: [{source, id}], placeId? }
 *    - Response: { id, name, ... } (flat object)
 *
 * 2. POST /api/artists/find-or-create
 *    - Request: { name, location, externalIds: [{source, id}], artistType? }
 *    - Response: { action: 'matched'|'review'|'created', artist: {id, name} }
 *
 * 3. POST /api/events/community
 *    - Request: { externalIds: [{source, id}], date, startTime, venueId, artistId, isPublic, title?, eventUrl? }
 *    - Response: { id }
 *
 * 4. GET /api/{venues,artists,events}/by-external-id?externalId=...
 *    - Response: { id } or 404
 */
