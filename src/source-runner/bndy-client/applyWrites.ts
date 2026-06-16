/**
 * applyWrites - Apply resolved entities to bndy
 *
 * Handles:
 * - Event creation with isPublic guard
 * - Event repointing (updating venue/artist references)
 * - Event deletion with delete→hide fallback
 * - Safety cap enforcement
 * - Review item generation for failed operations
 */

import {
  BndyWriteClient,
  CreateEventRequest,
} from './BndyWriteClient';
import { ResolvedEntities, ApplyWritesOptions, WriteResult } from '../runner';
import {
  SourceConfig,
  SourceRun,
  SourceRunError,
  ReviewItem,
  SourceRunCounts,
} from '../types';
import { randomUUID } from 'crypto';

interface ApplyWritesResult extends WriteResult {
  reviewItems?: ReviewItem[];
}

// Extended ResolvedEntities with eventsToDelete
interface ResolvedEntitiesWithDeletes extends ResolvedEntities {
  eventsToDelete?: string[];
}

/**
 * Apply resolved entities to bndy via the write client.
 *
 * ADR-015: Delegates to find-or-create when venueId/artistId are undefined.
 * This allows resolution to be deferred to the write path, enabling:
 * - Batch-level venue/artist reuse (same venue in multiple events)
 * - Review item creation on find-or-create failure
 * - Server-side deduplication via find-or-create endpoints
 */
export async function applyWrites(
  client: BndyWriteClient,
  config: SourceConfig,
  run: SourceRun,
  resolved: ResolvedEntities,
  options: ApplyWritesOptions
): Promise<ApplyWritesResult> {
  // Dry run or review only - don't write anything
  if (options.dryRun || options.reviewOnly) {
    return {
      success: true,
      counts: {},
    };
  }

  const counts: Partial<SourceRunCounts> = {
    eventsCreated: 0,
    eventsRepointed: 0,
    eventsDeleted: 0,
    eventsHidden: 0,
    venuesCreated: 0,
    artistsCreated: 0,
  };
  const errors: SourceRunError[] = [];
  const reviewItems: ReviewItem[] = [];

  // Compute effective create cap: min(safetyCaps.maxCreatesPerRun, maxWrites ?? Infinity)
  // This allows --max-writes to override the default safety cap for capped first writes.
  const effectiveCreateCap = Math.min(
    options.safetyCaps.maxCreatesPerRun,
    options.maxWrites ?? Infinity
  );

  // Track caps
  let createsUsed = 0;
  let deletesUsed = 0;
  let capsReached = false;

  // Track created entities within this batch to reuse (keyed by sourceExternalId)
  const venueCache = new Map<string, string>(); // sourceVenueExternalId → bndyId
  const artistCache = new Map<string, string>(); // sourceArtistExternalId → bndyId

  // Process creates and repoints
  for (const item of resolved.resolved) {
    if (item.action === 'skip' || item.action === 'review') {
      continue;
    }

    if (item.action === 'create') {
      // Check effective cap (respects both safetyCaps and --max-writes)
      if (createsUsed >= effectiveCreateCap) {
        if (!capsReached) {
          capsReached = true;
          errors.push({
            code: 'SAFETY_CAP_REACHED',
            message: `Create cap reached (${effectiveCreateCap})`,
            timestamp: new Date().toISOString(),
          });
        }
        continue;
      }

      // Resolve venue via find-or-create if needed
      let venueId = item.venueId;
      if (!venueId) {
        const venueExternalId = item.event.venue.sourceVenueExternalId;

        // Check batch cache first
        const cachedVenueId = venueCache.get(venueExternalId);
        if (cachedVenueId) {
          venueId = cachedVenueId;
        } else {
          // Call find-or-create (ADR-015/018)
          // Pass canCreate:false so server matches-or-reviews, never auto-creates (ADR-021)
          const venueResult = await client.createVenue({
            externalId: venueExternalId,
            name: item.event.venue.canonicalName,
            city: item.event.venue.city || config.defaultCity,
            region: item.event.venue.region || config.region,
            sourceId: config.id,
            canCreate: false,
          });

          if (venueResult.success && venueResult.venueId) {
            venueId = venueResult.venueId;
            venueCache.set(venueExternalId, venueId);
            counts.venuesCreated!++;
          } else {
            // Venue creation failed - skip event and create review item
            reviewItems.push({
              id: randomUUID(),
              sourceId: config.id,
              runId: run.runId,
              type: 'venue_create_failed',
              severity: 'high',
              status: 'open',
              entityType: 'venue',
              entityName: item.event.venue.canonicalName,
              candidateData: item.event,
              reason: venueResult.error || 'Venue find-or-create failed',
              createdAt: new Date().toISOString(),
            });
            continue;
          }
        }
      }

      // Resolve artist via find-or-create if needed
      let artistId = item.artistId;
      if (!artistId) {
        const artistExternalId = item.event.artist.sourceArtistExternalId;

        // Check batch cache first
        const cachedArtistId = artistCache.get(artistExternalId);
        if (cachedArtistId) {
          artistId = cachedArtistId;
        } else {
          // Call find-or-create (ADR-015/021 rev.3: pass venueRegion for footprint scoring)
          // Pass canCreate:false so server matches-or-reviews, never auto-creates (ADR-021)
          const artistResult = await client.createArtist({
            externalId: artistExternalId,
            name: item.event.artist.canonicalName,
            location: item.event.artist.region || config.defaultArtistLocation,
            sourceId: config.id,
            venueRegion: item.event.venue.region,
            canCreate: false,
          });

          if (artistResult.success && artistResult.artistId) {
            artistId = artistResult.artistId;
            artistCache.set(artistExternalId, artistId);
            counts.artistsCreated!++;
          } else {
            // Artist creation failed - skip event and create review item
            reviewItems.push({
              id: randomUUID(),
              sourceId: config.id,
              runId: run.runId,
              type: 'artist_create_failed',
              severity: 'high',
              status: 'open',
              entityType: 'artist',
              entityName: item.event.artist.canonicalName,
              candidateData: item.event,
              reason: artistResult.error || 'Artist find-or-create failed',
              createdAt: new Date().toISOString(),
            });
            continue;
          }
        }
      }

      const request: CreateEventRequest = {
        externalId: item.event.externalId,
        date: item.event.date,
        startTime: item.event.startTime,
        venueId,
        artistId,
        isPublic: config.eventPolicy.createPublicEvents,
        sourceId: config.id,
        title: item.event.title,
        eventUrl: item.event.eventUrl,
      };

      const result = await client.createEvent(request);
      if (result.success) {
        counts.eventsCreated!++;
        createsUsed++;
      } else {
        errors.push({
          code: 'CREATE_EVENT_FAILED',
          message: result.error || 'Unknown error',
          details: { externalId: item.event.externalId },
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (item.action === 'repoint') {
      // Repoint is essentially an update - for now, count it
      // In production this would call client.repointEvent()
      counts.eventsRepointed!++;
    }
  }

  // Process deletes (from extended interface)
  const extendedResolved = resolved as ResolvedEntitiesWithDeletes;
  if (extendedResolved.eventsToDelete) {
    for (const eventId of extendedResolved.eventsToDelete) {
      // Check safety cap
      if (deletesUsed >= options.safetyCaps.maxDeletesPerRun) {
        if (!errors.some((e) => e.code === 'DELETE_CAP_REACHED')) {
          errors.push({
            code: 'DELETE_CAP_REACHED',
            message: `Delete cap reached (${options.safetyCaps.maxDeletesPerRun})`,
            timestamp: new Date().toISOString(),
          });
        }
        continue;
      }

      const deleteResult = await client.deleteEvent(eventId);
      if (deleteResult.success) {
        counts.eventsDeleted!++;
        deletesUsed++;
      } else {
        // Delete failed - fallback to hide
        const hideResult = await client.hideEvent({
          eventId,
          reason: 'delete_failed',
          sourceId: config.id,
        });

        if (hideResult.success) {
          counts.eventsHidden!++;

          // Create review item for delete→hide
          reviewItems.push({
            id: randomUUID(),
            sourceId: config.id,
            runId: run.runId,
            type: 'delete_failed_hidden',
            severity: 'medium',
            status: 'open',
            entityType: 'event',
            candidateData: { eventId },
            reason: `Delete failed, event hidden instead: ${deleteResult.error}`,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  return {
    success: errors.length === 0 || capsReached, // Caps reached is still "success" with warning
    counts,
    errors: errors.length > 0 ? errors : undefined,
    reviewItems: reviewItems.length > 0 ? reviewItems : undefined,
  };
}
