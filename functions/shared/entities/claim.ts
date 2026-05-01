import { z } from 'zod';

export const ClaimTypeSchema = z.enum([
  'event_exists',
  'artist_performs',
  'venue_hosts',
  'event_date',
  'event_time',
  'ticket_source',
  'artist_exists',
  'venue_exists',
  'relationship',
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClaimStatusSchema = z.enum([
  'proposed',
  'accepted',
  'challenged',
  'superseded',
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const StrengthSchema = z.enum(['weak', 'moderate', 'strong']);
export type Strength = z.infer<typeof StrengthSchema>;

export const ClaimSchema = z.object({
  claimId: z.string().regex(/^clm_[a-zA-Z0-9]{8}$/),
  claimType: ClaimTypeSchema,

  // What the claim asserts
  subject: z.string(),
  predicate: z.string(),
  object: z.string().optional(),
  value: z.string().optional(),

  // Strength assessment
  strength: StrengthSchema,
  strengthReasoning: z.string(),

  // Source
  interpretationId: z.string().regex(/^intp_[a-zA-Z0-9]{8}$/),
  signalId: z.string().regex(/^sgnl_[a-zA-Z0-9]{8}$/),

  // Entity matching (deterministic, not confidence)
  matchedEntityId: z.string().optional(),
  entityMatchScore: z.number().min(0).max(1).optional(),

  // Status
  status: ClaimStatusSchema,

  // Timestamps
  createdAt: z.string().datetime(),
  reviewedAt: z.string().datetime().optional(),
  reviewedBy: z.string().optional(),
  challengeReason: z.string().optional(),
}).refine((claim) => claim.object || claim.value, {
  message: 'Claim must include either object or value',
});

export type Claim = z.infer<typeof ClaimSchema>;
