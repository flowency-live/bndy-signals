import { z } from 'zod';

export const CorroborationStrengthSchema = z.enum(['weak', 'moderate', 'strong']);
export type CorroborationStrength = z.infer<typeof CorroborationStrengthSchema>;

export const PackStatusSchema = z.enum([
  'gathering',
  'ready_for_review',
  'under_review',
  'published',
  'rejected',
]);
export type PackStatus = z.infer<typeof PackStatusSchema>;

export const PackSubjectSchema = z.object({
  type: z.enum(['event', 'venue', 'artist']),
  description: z.string(),
  candidateEntityId: z.string().optional(),
});
export type PackSubject = z.infer<typeof PackSubjectSchema>;

export const SignalReferenceSchema = z.object({
  signalId: z.string(),
  signalType: z.string(),
  addedAt: z.string().datetime(),
  contribution: z.string(),
});
export type SignalReference = z.infer<typeof SignalReferenceSchema>;

export const InterpretationReferenceSchema = z.object({
  interpretationId: z.string(),
  signalId: z.string(),
  version: z.number().int().positive(),
  claimCount: z.number().int().nonnegative(),
});
export type InterpretationReference = z.infer<typeof InterpretationReferenceSchema>;

export const ClaimReferenceSchema = z.object({
  claimId: z.string(),
  claimType: z.string(),
  value: z.string(),
  status: z.enum(['proposed', 'accepted', 'challenged']),
});
export type ClaimReference = z.infer<typeof ClaimReferenceSchema>;

export const ProposedEventSchema = z.object({
  name: z.string(),
  date: z.string(),
  venueRef: z.string(),
  artistRefs: z.array(z.string()),
  confidence: CorroborationStrengthSchema,
});
export type ProposedEvent = z.infer<typeof ProposedEventSchema>;

export const ProposedVenueSchema = z.object({
  name: z.string(),
  location: z.string().optional(),
  matchedEntityId: z.string().optional(),
  isNew: z.boolean(),
});
export type ProposedVenue = z.infer<typeof ProposedVenueSchema>;

export const ProposedArtistSchema = z.object({
  name: z.string(),
  matchedEntityId: z.string().optional(),
  isNew: z.boolean(),
});
export type ProposedArtist = z.infer<typeof ProposedArtistSchema>;

export const ProposedRelationshipSchema = z.object({
  type: z.string(),
  fromEntity: z.string(),
  toEntity: z.string(),
});
export type ProposedRelationship = z.infer<typeof ProposedRelationshipSchema>;

export const ProposedEntitiesSchema = z.object({
  events: z.array(ProposedEventSchema),
  venues: z.array(ProposedVenueSchema),
  artists: z.array(ProposedArtistSchema),
  relationships: z.array(ProposedRelationshipSchema),
});
export type ProposedEntities = z.infer<typeof ProposedEntitiesSchema>;

export const EvidencePackSchema = z.object({
  packId: z.string().regex(/^pack_[a-zA-Z0-9]{8}$/),

  // What this pack is about
  subject: PackSubjectSchema,

  // Contributing evidence
  signals: z.array(SignalReferenceSchema),
  interpretations: z.array(InterpretationReferenceSchema),
  claims: z.array(ClaimReferenceSchema),

  // Corroboration assessment (NOT numeric)
  corroborationStrength: CorroborationStrengthSchema,
  corroborationReasoning: z.string(),

  // What this evidence proposes
  proposedEntities: ProposedEntitiesSchema,

  // Lifecycle
  status: PackStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),
});

export type EvidencePack = z.infer<typeof EvidencePackSchema>;
