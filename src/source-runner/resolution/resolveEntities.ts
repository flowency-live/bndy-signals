/**
 * resolveEntities - Entity Resolution Orchestrator
 *
 * Resolves venues and artists for events, builds eventsToDelete list.
 * Enforces the never-delete-past guard (finding G):
 * - cancelledCandidates (future) → eventsToDelete
 * - pastDropped → NEVER added to eventsToDelete
 * - Only fire deletes when snapshotSemantics === 'complete'
 */

import { SourceConfig, EventDiffReport, NormalisedEvent, ReviewItem } from '../types';
import { ResolvedEntities } from '../runner';
import { SourceStateStore } from './SourceStateStore';
import { BndyWriteClient } from '../bndy-client/BndyWriteClient';
import { resolveVenue, VenueResolutionResult } from './resolveVenue';
import { resolveArtist, ArtistResolutionResult } from './resolveArtist';
import { randomUUID } from 'crypto';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ResolveEntitiesOptions {
  stateStore: SourceStateStore;
  client: BndyWriteClient;
  /**
   * Whether CREATE_NEW is allowed for new entities.
   * When true, entities that can't be matched are delegated to
   * find-or-create APIs in applyWrites (ADR-015).
   */
  canCreate?: boolean;
}

export interface ResolveEntitiesResult extends ResolvedEntities {
  eventsToDelete: string[];
}

// -----------------------------------------------------------------------------
// Orchestrator
// -----------------------------------------------------------------------------

export async function resolveEntities(
  config: SourceConfig,
  diff: EventDiffReport,
  options: ResolveEntitiesOptions
): Promise<ResolveEntitiesResult> {
  const { stateStore, client } = options;
  const resolved: ResolvedEntities['resolved'] = [];
  const reviewItems: ReviewItem[] = [];
  const eventsToDelete: string[] = [];

  // Process added events
  for (const event of diff.added) {
    const resolution = await resolveEvent(event, config.id, options);

    resolved.push({
      event,
      venueId: resolution.venueId,
      artistId: resolution.artistId,
      action: resolution.action,
    });

    // Add review items if any
    if (resolution.reviewItems) {
      reviewItems.push(...resolution.reviewItems);
    }
  }

  // Process cancellations (never-delete-past guard)
  // Only process cancellations for 'complete' snapshot semantics
  if (config.snapshotSemantics === 'complete') {
    for (const event of diff.cancelledCandidates) {
      // Resolve the event to its bndy ID
      const eventLookup = await client.lookupByExternalId(event.externalId, 'event');
      if (eventLookup) {
        eventsToDelete.push(eventLookup.id);
      }
    }
  }
  // Note: pastDropped events are NEVER added to eventsToDelete
  // This is the finding G guard - past events should never be deleted

  // Note: one_shot and incremental sources never produce eventsToDelete
  // - one_shot: single paste, no baseline to compare against
  // - incremental: route absences to review instead of auto-cancelling

  return {
    resolved,
    reviewItems,
    eventsToDelete,
  };
}

// -----------------------------------------------------------------------------
// Event Resolution Helper
// -----------------------------------------------------------------------------

interface EventResolutionResult {
  venueId?: string;
  artistId?: string;
  action: 'create' | 'repoint' | 'skip' | 'review';
  reviewItems?: ReviewItem[];
}

async function resolveEvent(
  event: NormalisedEvent,
  sourceId: string,
  options: ResolveEntitiesOptions
): Promise<EventResolutionResult> {
  const reviewItems: ReviewItem[] = [];

  // Resolve venue
  const venueResult = await resolveVenue(event.venue, sourceId, options);
  let venueId: string | undefined;

  if (venueResult.action === 'MATCH_EXISTING') {
    venueId = venueResult.bndyId;
  } else if (venueResult.action === 'CREATE_NEW') {
    // Will be created during applyWrites
    // For now, mark as needing creation
    venueId = undefined;
  } else if (venueResult.action === 'REVIEW_REQUIRED') {
    reviewItems.push(createReviewItem(
      sourceId,
      'venue_match_ambiguous',
      'venue',
      event.venue.canonicalName,
      venueResult.reviewReason || 'Venue resolution requires review',
      event
    ));
    return { action: 'review', reviewItems };
  }

  // Resolve artist
  const artistResult = await resolveArtist(event.artist, sourceId, options);
  let artistId: string | undefined;

  if (artistResult.action === 'MATCH_EXISTING') {
    artistId = artistResult.bndyId;
  } else if (artistResult.action === 'CREATE_NEW') {
    // Will be created during applyWrites
    artistId = undefined;
  } else if (artistResult.action === 'REVIEW_REQUIRED') {
    reviewItems.push(createReviewItem(
      sourceId,
      'artist_match_ambiguous',
      'artist',
      event.artist.canonicalName,
      artistResult.reviewReason || 'Artist resolution requires review',
      event
    ));
    return { action: 'review', reviewItems };
  }

  // Both resolved or will be created
  return {
    venueId,
    artistId,
    action: 'create',
    reviewItems: reviewItems.length > 0 ? reviewItems : undefined,
  };
}

// -----------------------------------------------------------------------------
// Review Item Helper
// -----------------------------------------------------------------------------

function createReviewItem(
  sourceId: string,
  type: ReviewItem['type'],
  entityType: 'venue' | 'artist' | 'event',
  entityName: string,
  reason: string,
  event: NormalisedEvent
): ReviewItem {
  return {
    id: randomUUID(),
    sourceId,
    runId: '', // Will be set by caller
    type,
    severity: 'medium',
    status: 'open',
    entityType,
    entityName,
    candidateData: event,
    reason,
    createdAt: new Date().toISOString(),
  };
}
