import { z } from 'zod';
import { ClaimReferenceSchema, ClaimReference } from './evidence-pack';

// Re-export for backwards compatibility
export { ClaimReferenceSchema, ClaimReference };

export const CandidateStatusSchema = z.enum(['proposed', 'ratified', 'rejected', 'merged']);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const CompletenessSchema = z.enum(['partial', 'complete']);
export type Completeness = z.infer<typeof CompletenessSchema>;

export const CandidateVerificationStatusSchema = z.enum(['unverified', 'submitter_verified']);
export type CandidateVerificationStatus = z.infer<typeof CandidateVerificationStatusSchema>;

export const AmbiguityTypeSchema = z.enum([
  'entity_match',
  'date_uncertain',
  'conflicting',
  'incomplete',
]);
export type AmbiguityType = z.infer<typeof AmbiguityTypeSchema>;

export const AmbiguitySchema = z.object({
  ambiguityType: AmbiguityTypeSchema,
  description: z.string(),
  affectedClaimIds: z.array(z.string().regex(/^clm_[a-zA-Z0-9]{8}$/)),
  suggestedResolution: z.string().optional(),
});
export type Ambiguity = z.infer<typeof AmbiguitySchema>;

export const EventCandidateSchema = z.object({
  candidateId: z.string().regex(/^cand_[a-zA-Z0-9]{8}$/),
  candidateType: z.literal('event'),
  signalId: z.string().regex(/^sgnl_[a-zA-Z0-9]{8}$/),
  interpretationId: z.string().regex(/^intp_[a-zA-Z0-9]{8}$/),

  // LLM-proposed fields
  proposedName: z.string().min(1),
  proposedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  proposedTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  proposedVenueId: z.string().regex(/^vnue_[a-zA-Z0-9]{8}$/).optional(),
  proposedArtistIds: z.array(z.string().regex(/^arts_[a-zA-Z0-9]{8}$/)),

  // LLM reasoning - required for explainability (Brain principle)
  reasoning: z.string().min(1),

  // Raw claim references
  sourceClaims: z.array(ClaimReferenceSchema).min(1),

  // Completeness
  completeness: CompletenessSchema,
  missingFields: z.array(z.string()),

  // Ambiguity
  ambiguities: z.array(AmbiguitySchema),

  // Trusted source fast-path
  verificationStatus: CandidateVerificationStatusSchema,
  submitterId: z.string().optional(),

  // Lifecycle
  status: CandidateStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ratifiedAt: z.string().datetime().optional(),
  ratifiedBy: z.string().optional(),

  // Merge tracking
  mergedInto: z.string().regex(/^cand_[a-zA-Z0-9]{8}$/).optional(),

  // Evidence Pack link (set by pack-builder after interpretation)
  evidencePackId: z.string().regex(/^pack_[a-zA-Z0-9]{8}$/).optional(),
});

export type EventCandidate = z.infer<typeof EventCandidateSchema>;

/**
 * Generate a new candidate ID
 */
export function generateCandidateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `cand_${suffix}`;
}

/**
 * Calculate completeness based on available fields
 */
export function calculateCompleteness(candidate: Partial<EventCandidate>): {
  completeness: Completeness;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  if (!candidate.proposedName) {
    missingFields.push('name');
  }
  if (!candidate.proposedDate) {
    missingFields.push('date');
  }
  if (!candidate.proposedVenueId) {
    missingFields.push('venue');
  }
  if (!candidate.proposedArtistIds || candidate.proposedArtistIds.length === 0) {
    missingFields.push('artists');
  }

  return {
    completeness: missingFields.length === 0 ? 'complete' : 'partial',
    missingFields,
  };
}
