/**
 * bndy Source Runner Domain Types
 *
 * These types define the core domain model for the source runner.
 * Based on the KLMA MVP Spec with corrections from the handoff pack.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Source Configuration
// -----------------------------------------------------------------------------

export const SourceInputKindSchema = z.enum([
  'google_sheet_csv',
  'csv_url',
  'json_url',
  'js_rendered_page', // On The Case, other client-rendered sites
]);
export type SourceInputKind = z.infer<typeof SourceInputKindSchema>;

export const SourceInputSchema = z.object({
  kind: SourceInputKindSchema,
  sheetId: z.string().optional(),
  gid: z.string().optional(),
  preferredExport: z.enum(['export_csv', 'gviz_csv']).optional(),
  fallbackExport: z.enum(['export_csv', 'gviz_csv']).optional(),
  gvizRealignment: z
    .object({
      dropLeadingColumn: z.boolean(),
      keepColumns: z.number(),
    })
    .optional(),
  url: z.string().url().optional(),
});
export type SourceInput = z.infer<typeof SourceInputSchema>;

export const EventPolicySchema = z.object({
  createPublicEvents: z.boolean(),
  missingTimeDefault: z.string().regex(/^\d{2}:\d{2}$/),
  deleteFutureMissingRows: z.boolean(),
  neverDeletePastEvents: z.boolean(),
  duplicateEventBehaviour: z.enum([
    'attach_external_id_no_clobber',
    'skip',
    'review',
  ]),
});
export type EventPolicy = z.infer<typeof EventPolicySchema>;

export const ParkingLotConfigSchema = z.object({
  specialistVenueSlugs: z.array(z.string()),
  multiActVenueSlugs: z.array(z.string()),
  reasons: z.array(z.string()),
});
export type ParkingLotConfig = z.infer<typeof ParkingLotConfigSchema>;

export const ThresholdsSchema = z.object({
  venueAutoMatch: z.number().min(0).max(1),
  artistAutoMatch: z.number().min(0).max(1),
  eventAutoCreate: z.number().min(0).max(1),
  socialAutoAttach: z.number().min(0).max(1),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

export const ScheduleSchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'manual']),
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const RegionOverrideSchema = z.object({
  defaultRegion: z.string(),
  defaultCity: z.string(),
  overrideTowns: z.record(z.string(), z.string()), // town -> region
});
export type RegionOverride = z.infer<typeof RegionOverrideSchema>;

export const SnapshotSemanticsSchema = z.enum([
  'complete', // Full snapshot - can infer cancellations (KLMA CSV)
  'incremental', // Partial/paginated - route absences to review
  'one_shot', // Single paste - never infer cancellations
]);
export type SnapshotSemantics = z.infer<typeof SnapshotSemanticsSchema>;

export const SourceConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['community_sheet', 'venue_website', 'aggregator', 'feed']),
  region: z.string(),
  defaultCity: z.string(),
  defaultArtistLocation: z.string(),
  timezone: z.string(),
  schedule: ScheduleSchema,
  input: SourceInputSchema,
  eventPolicy: EventPolicySchema,
  parkingLot: ParkingLotConfigSchema,
  thresholds: ThresholdsSchema,
  regionOverride: RegionOverrideSchema.optional(),
  snapshotSemantics: SnapshotSemanticsSchema.default('complete'),
});
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

// -----------------------------------------------------------------------------
// Source Run
// -----------------------------------------------------------------------------

export const SourceRunStatusSchema = z.enum([
  'started',
  'download_failed',
  'parse_failed',
  'diff_failed',
  'write_failed',
  'completed',
  'completed_with_review_items',
]);
export type SourceRunStatus = z.infer<typeof SourceRunStatusSchema>;

export const SourceRunErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  timestamp: z.string(),
});
export type SourceRunError = z.infer<typeof SourceRunErrorSchema>;

export const SourceRunCountsSchema = z.object({
  rawRows: z.number(),
  validEvents: z.number(),
  metadataRows: z.number(),
  parkedRows: z.number(),
  added: z.number(),
  cancelled: z.number(),
  unchanged: z.number(),
  pastDropped: z.number(),
  eventsCreated: z.number(),
  eventsRepointed: z.number(),
  eventsDeleted: z.number(),
  eventsHidden: z.number(),
  venuesCreated: z.number(),
  venuesMatched: z.number(),
  artistsCreated: z.number(),
  artistsMatched: z.number(),
  reviewItems: z.number(),
});
export type SourceRunCounts = z.infer<typeof SourceRunCountsSchema>;

export const SourceRunSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  runDate: z.string(), // YYYY-MM-DD
  startedAt: z.string(), // ISO timestamp
  completedAt: z.string().optional(),
  status: SourceRunStatusSchema,
  counts: SourceRunCountsSchema,
  errors: z.array(SourceRunErrorSchema),
});
export type SourceRun = z.infer<typeof SourceRunSchema>;

// -----------------------------------------------------------------------------
// Normalised Entities
// -----------------------------------------------------------------------------

export const NormalisedVenueRefSchema = z.object({
  sourceVenueExternalId: z.string(),
  sourceName: z.string(),
  canonicalName: z.string(),
  city: z.string().optional(),
  region: z.string().optional(),
  nameVariants: z.array(z.string()),
  /** Full street address for geocoding (ADR-018). Optional - not all sources provide this. */
  fullAddress: z.string().optional(),
});
export type NormalisedVenueRef = z.infer<typeof NormalisedVenueRefSchema>;

export const ArtistTypeSchema = z.enum([
  'solo',
  'duo',
  'trio',
  'band',
  'event',
]);
export type ArtistType = z.infer<typeof ArtistTypeSchema>;

export const NormalisedArtistRefSchema = z.object({
  sourceArtistExternalId: z.string(),
  sourceName: z.string(),
  canonicalName: z.string(),
  titleOverride: z.string().optional(),
  artistType: ArtistTypeSchema.optional(),
  actType: z.array(z.string()).optional(),
  region: z.string().optional(),
});
export type NormalisedArtistRef = z.infer<typeof NormalisedArtistRefSchema>;

export const TimeProvenanceSchema = z.enum([
  'parsed',
  'inferred_afternoon',
  'inferred_evening',
  'defaulted_from_corrupt_time',
  'defaulted_from_missing',
]);
export type TimeProvenance = z.infer<typeof TimeProvenanceSchema>;

export const NormalisedEventSchema = z.object({
  sourceId: z.string(),
  externalId: z.string(),
  date: z.string(), // YYYY-MM-DD
  startTime: z.string().nullable(), // HH:MM or null
  timeProvenance: TimeProvenanceSchema.optional(),
  venue: NormalisedVenueRefSchema,
  artist: NormalisedArtistRefSchema,
  title: z.string().optional(),
  eventUrl: z.string().optional(),
  notes: z.string().optional(),
  rawRowRef: z.string(),
  confidence: z.number().min(0).max(1),
  parseWarnings: z.array(z.string()),
});
export type NormalisedEvent = z.infer<typeof NormalisedEventSchema>;

// -----------------------------------------------------------------------------
// Parking Lot
// -----------------------------------------------------------------------------

export const ParkingLotReasonSchema = z.enum([
  'specialist_venue',
  'multi_act',
  'non_artist_event',
  'form_metadata',
  'time_unconfirmed',
  'unparseable',
  'low_confidence_match',
  'date_sentinel',
  'cheshire_unknown_town',
  // On The Case specific
  'placeholder_performer',
  'jam_night',
  'generic_recurring',
  'private_function',
  'placeholder_venue',
  // gigs-news specific
  'generic_dj',
  'venue_only',
  'venue_geocode_risk',
]);
export type ParkingLotReason = z.infer<typeof ParkingLotReasonSchema>;

export const ParkingLotItemSchema = z.object({
  sourceId: z.string(),
  runId: z.string(),
  reason: ParkingLotReasonSchema,
  rawRow: z.record(z.unknown()),
  normalisedPartial: NormalisedEventSchema.partial().optional(),
  createdAt: z.string(),
});
export type ParkingLotItem = z.infer<typeof ParkingLotItemSchema>;

// -----------------------------------------------------------------------------
// Diff Report
// -----------------------------------------------------------------------------

export const EventDiffReportSchema = z.object({
  sourceId: z.string(),
  runDate: z.string(),
  priorRunDate: z.string().optional(),
  added: z.array(NormalisedEventSchema),
  cancelledCandidates: z.array(NormalisedEventSchema),
  unchanged: z.array(NormalisedEventSchema),
  pastDropped: z.array(NormalisedEventSchema),
});
export type EventDiffReport = z.infer<typeof EventDiffReportSchema>;

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

export const ResolutionActionSchema = z.enum([
  'MATCH_EXISTING',
  'CREATE_NEW',
  'REVIEW_REQUIRED',
  'SKIP',
]);
export type ResolutionAction = z.infer<typeof ResolutionActionSchema>;

export const EntityResolutionResultSchema = z.object({
  action: ResolutionActionSchema,
  entityType: z.enum(['venue', 'artist']),
  bndyId: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  matchedEntity: z.unknown().optional(),
  proposedCreate: z.unknown().optional(),
  reviewReason: z.string().optional(),
});
export type EntityResolutionResult = z.infer<
  typeof EntityResolutionResultSchema
>;

// -----------------------------------------------------------------------------
// Review Queue
// -----------------------------------------------------------------------------

export const ReviewItemTypeSchema = z.enum([
  'artist_match_ambiguous',
  'venue_match_ambiguous',
  'artist_social_uncertain',
  'venue_create_risk',
  'event_duplicate_risk',
  'source_structure_changed',
  'parser_count_anomaly',
  'write_failure',
  'specialist_venue',
  'multi_act_event',
  'delete_failed_hidden',
  'venue_create_failed',
  'artist_create_failed',
]);
export type ReviewItemType = z.infer<typeof ReviewItemTypeSchema>;

export const ReviewItemSeveritySchema = z.enum(['low', 'medium', 'high']);
export type ReviewItemSeverity = z.infer<typeof ReviewItemSeveritySchema>;

export const ReviewItemStatusSchema = z.enum([
  'open',
  'accepted',
  'rejected',
  'resolved',
]);
export type ReviewItemStatus = z.infer<typeof ReviewItemStatusSchema>;

export const ReviewItemSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  runId: z.string(),
  type: ReviewItemTypeSchema,
  severity: ReviewItemSeveritySchema,
  status: ReviewItemStatusSchema,
  entityType: z.enum(['venue', 'artist', 'event']).optional(),
  entityName: z.string().optional(),
  candidateData: z.unknown(),
  recommendedAction: z.string().optional(),
  reason: z.string(),
  createdAt: z.string(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

// -----------------------------------------------------------------------------
// CLI Options
// -----------------------------------------------------------------------------

export const RunSourceOptionsSchema = z.object({
  sourceId: z.string(),
  date: z.string(), // YYYY-MM-DD
  dryRun: z.boolean().default(false),
  localStorage: z.boolean().default(false),
  maxWrites: z.number().optional(),
  reviewOnly: z.boolean().default(false),
});
export type RunSourceOptions = z.infer<typeof RunSourceOptionsSchema>;

// -----------------------------------------------------------------------------
// Runner Result
// -----------------------------------------------------------------------------

export const SourceRunResultSchema = z.object({
  run: SourceRunSchema,
  diff: EventDiffReportSchema.optional(),
  reviewItems: z.array(ReviewItemSchema),
  reportPath: z.string().optional(),
});
export type SourceRunResult = z.infer<typeof SourceRunResultSchema>;

// -----------------------------------------------------------------------------
// Safety Caps
// -----------------------------------------------------------------------------

export const SafetyCapsSchema = z.object({
  maxCreatesPerRun: z.number().default(50),
  maxDeletesPerRun: z.number().default(20),
  maxVenueCreatesPerRun: z.number().default(20),
  maxArtistCreatesPerRun: z.number().default(30),
  maxReviewItemsPerRun: z.number().default(100),
});
export type SafetyCaps = z.infer<typeof SafetyCapsSchema>;

export const DEFAULT_SAFETY_CAPS: SafetyCaps = {
  maxCreatesPerRun: 50,
  maxDeletesPerRun: 20,
  maxVenueCreatesPerRun: 20,
  maxArtistCreatesPerRun: 30,
  maxReviewItemsPerRun: 100,
};
