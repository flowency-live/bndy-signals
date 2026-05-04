import { z } from 'zod';

// Categorical strength - not numeric
export const CorroborationStrengthSchema = z.enum(['weak', 'moderate', 'strong']);
export type CorroborationStrength = z.infer<typeof CorroborationStrengthSchema>;

// Pack lifecycle - cognitive, not review-queue
export const PackStatusSchema = z.enum([
  'gathering',   // Accumulating evidence
  'ready',       // Sufficient evidence for action
  'ratified',    // Candidate ratified based on this pack
  'rejected',    // Pack rejected
]);
export type PackStatus = z.infer<typeof PackStatusSchema>;

// What kind of proposition this pack supports
export const PropositionTypeSchema = z.enum([
  'event',           // "Artist X plays at Venue Y on Date Z"
  'artist_venue',    // "Artist X regularly performs at Venue Y"
  'venue_location',  // "Venue X is located in City Y"
  'artist_exists',   // "Artist X exists and is a performer"
  'venue_exists',    // "Venue X exists and is a live music venue"
]);
export type PropositionType = z.infer<typeof PropositionTypeSchema>;

// The core Evidence Pack schema - cognitive core, not review artefact
export const EvidencePackSchema = z.object({
  packId: z.string().regex(/^pack_[a-zA-Z0-9]{8}$/),

  // What this pack supports (the proposition)
  proposition: z.string().min(1),
  propositionKey: z.string().min(1),  // Normalized key for matching variants
  propositionType: PropositionTypeSchema,

  // Contributing evidence (all required, min 1 each)
  signalIds: z.array(z.string()).min(1),
  interpretationIds: z.array(z.string()).min(1),
  claimIds: z.array(z.string()).min(1),

  // What this pack outputs/supports
  candidateIds: z.array(z.string()),  // Event candidates this pack supports (can be empty)

  // Corroboration assessment - categorical with reasoning
  corroborationStrength: CorroborationStrengthSchema,
  corroborationReasoning: z.string().min(1),  // WHY this strength - required for explainability

  // Source tracking (for strength calculation)
  sourceCount: z.number().int().nonnegative(),

  // Lifecycle
  status: PackStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type EvidencePack = z.infer<typeof EvidencePackSchema>;

// Helper to calculate corroboration strength from source counts
// Returns categorical strength with reasoning
export function calculateCorroborationStrength(input: {
  sourceCount: number;
  trustedSourceCount: number;
}): { strength: CorroborationStrength; reasoning: string } {
  const { sourceCount, trustedSourceCount } = input;

  // Strong: 3+ sources OR 2+ trusted sources
  if (sourceCount >= 3) {
    return {
      strength: 'strong',
      reasoning: `3+ independent sources (${sourceCount}) agree on this proposition`,
    };
  }

  if (trustedSourceCount >= 2) {
    return {
      strength: 'strong',
      reasoning: `${trustedSourceCount} trusted sources confirm this proposition`,
    };
  }

  // Moderate: 2 sources OR 1 trusted source
  if (sourceCount === 2) {
    return {
      strength: 'moderate',
      reasoning: `2 independent sources agree on this proposition`,
    };
  }

  if (trustedSourceCount === 1) {
    return {
      strength: 'moderate',
      reasoning: `1 trusted source confirms this proposition`,
    };
  }

  // Weak: single source, no corroboration
  return {
    strength: 'weak',
    reasoning: `Single source, no corroboration yet`,
  };
}

// Legacy exports for backwards compatibility (used by event-candidate.ts)
// TODO: Remove after event-candidate.ts is updated to use new types
export const ClaimReferenceSchema = z.object({
  claimId: z.string(),
  claimType: z.string(),
  value: z.string(),
  status: z.enum(['proposed', 'accepted', 'challenged']),
});
export type ClaimReference = z.infer<typeof ClaimReferenceSchema>;
