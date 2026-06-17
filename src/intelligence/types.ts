/**
 * Intelligence Resolver Types
 *
 * Types for the LLM-powered resolution step (#70).
 * Spec: bndy brain/04-architecture/intelligence-resolver-spec.md
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Review Item Input (from the queue)
// -----------------------------------------------------------------------------

export const ReviewItemInputSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  runId: z.string(),
  entityType: z.enum(['artist', 'venue']),
  entityName: z.string(),
  sourceContext: z.object({
    venueName: z.string().optional(),
    venueRegion: z.string().optional(),
    date: z.string().optional(),
    coActs: z.array(z.string()).optional(),
    sourceDefaultRegion: z.string().optional(),
  }),
  candidateData: z.unknown(),
  reason: z.string(),
});
export type ReviewItemInput = z.infer<typeof ReviewItemInputSchema>;

// -----------------------------------------------------------------------------
// Candidate Evidence
// -----------------------------------------------------------------------------

export const CandidateEvidenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string().optional(),
  fbHandle: z.string().optional(),
  genres: z.array(z.string()).optional(),
  footprint: z.object({
    regions: z.record(z.number()), // region → weight
    totalEvents: z.number(),
  }).optional(),
  similarity: z.number(), // 0-100 name similarity score
});
export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>;

// -----------------------------------------------------------------------------
// LLM Resolution Output
// -----------------------------------------------------------------------------

export const LLMDecisionSchema = z.enum(['match', 'create', 'split', 'uncertain']);
export type LLMDecision = z.infer<typeof LLMDecisionSchema>;

export const LLMResolutionOutputSchema = z.object({
  decision: LLMDecisionSchema,
  entityId: z.string().optional(), // bndy id if match
  splitInto: z.array(z.string()).optional(), // only when decision=split
  act: z.string().optional(), // ADR-023 act-variant (e.g., 'Acoustic Duo')
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  evidenceUsed: z.array(z.string()),
});
export type LLMResolutionOutput = z.infer<typeof LLMResolutionOutputSchema>;

// -----------------------------------------------------------------------------
// Resolution Context (full input to LLM)
// -----------------------------------------------------------------------------

export const ResolutionContextSchema = z.object({
  item: ReviewItemInputSchema,
  candidates: z.array(CandidateEvidenceSchema),
});
export type ResolutionContext = z.infer<typeof ResolutionContextSchema>;

// -----------------------------------------------------------------------------
// Resolution Result (final outcome)
// -----------------------------------------------------------------------------

export const ResolutionActionSchema = z.enum([
  'auto_applied', // confidence >= T_high, match only
  'proposed', // needs human review
  'skipped', // no candidates or error
]);
export type ResolutionAction = z.infer<typeof ResolutionActionSchema>;

export const ResolutionResultSchema = z.object({
  reviewItemId: z.string(),
  action: ResolutionActionSchema,
  llmOutput: LLMResolutionOutputSchema.optional(),
  appliedEntityId: z.string().optional(), // set when auto_applied
  cost: z.object({
    modelId: z.string(),
    tokensIn: z.number(),
    tokensOut: z.number(),
    runtimeMs: z.number(),
    estimatedCostUSD: z.number(),
  }).optional(),
  error: z.string().optional(),
});
export type ResolutionResult = z.infer<typeof ResolutionResultSchema>;

// -----------------------------------------------------------------------------
// Resolver Configuration
// -----------------------------------------------------------------------------

export const ResolverConfigSchema = z.object({
  // Confidence thresholds (from spec: rec 90/70)
  thresholdHigh: z.number().default(90), // auto-apply MATCH above this
  thresholdLow: z.number().default(70), // below this → uncertain
  marginRequired: z.number().default(10), // clear winner margin

  // Bedrock model (Haiku 4.5 - same as interpretation-runner)
  modelId: z.string().default('eu.anthropic.claude-haiku-4-5-20251001-v1:0'),

  // Cost guardrails
  maxCostPerRun: z.number().default(1.0), // USD
  maxItemsPerRun: z.number().default(100),

  // Feature flags
  dryRun: z.boolean().default(false), // don't auto-apply
  autoApplyEnabled: z.boolean().default(true),
});
export type ResolverConfig = z.infer<typeof ResolverConfigSchema>;

export const DEFAULT_RESOLVER_CONFIG: ResolverConfig = {
  thresholdHigh: 90,
  thresholdLow: 70,
  marginRequired: 10,
  modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
  maxCostPerRun: 1.0,
  maxItemsPerRun: 100,
  dryRun: false,
  autoApplyEnabled: true,
};
