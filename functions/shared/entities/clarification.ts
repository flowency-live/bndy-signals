import { z } from 'zod';

// Clarification lifecycle
export const ClarificationStatusSchema = z.enum([
  'open',      // Awaiting user response
  'resolved',  // User provided answer
  'dismissed', // User dismissed without answering
]);
export type ClarificationStatus = z.infer<typeof ClarificationStatusSchema>;

// What kind of clarification is needed
export const ClarificationQuestionTypeSchema = z.enum([
  'entity_match',    // Which entity does this refer to?
  'date_confirm',    // Is this the correct date?
  'venue_location',  // Where is this venue?
  'artist_identity', // Which artist is this?
  'event_time',      // What time is the event?
]);
export type ClarificationQuestionType = z.infer<typeof ClarificationQuestionTypeSchema>;

// An option the user can select
export const ClarificationOptionSchema = z.object({
  optionId: z.string().regex(/^opt_[a-zA-Z0-9]{8}$/),
  label: z.string().min(1),
  entityId: z.string().optional(),  // If selecting an existing entity
  confidence: z.number().min(0).max(1).optional(),  // How likely this is correct
});
export type ClarificationOption = z.infer<typeof ClarificationOptionSchema>;

// The core Clarification Request schema
export const ClarificationRequestSchema = z.object({
  clarificationId: z.string().regex(/^clar_[a-zA-Z0-9]{8}$/),

  // What needs clarifying (at least one required)
  candidateId: z.string().regex(/^cand_[a-zA-Z0-9]{8}$/).optional(),
  claimId: z.string().regex(/^clm_[a-zA-Z0-9]{8}$/).optional(),
  evidencePackId: z.string().regex(/^pack_[a-zA-Z0-9]{8}$/).optional(),

  // The question
  question: z.string().min(1),
  questionType: ClarificationQuestionTypeSchema,

  // Options if applicable (empty for free-form)
  options: z.array(ClarificationOptionSchema),

  // Resolution
  status: ClarificationStatusSchema,
  resolvedBy: z.string().optional(),    // User who resolved
  resolution: z.string().optional(),    // The answer (entityId, value, etc.)
  resolvedAt: z.string().datetime().optional(),

  // Lifecycle
  createdAt: z.string().datetime(),
});

export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;

// Generate a clarification ID
export function generateClarificationId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `clar_${suffix}`;
}

// Generate an option ID
export function generateOptionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `opt_${suffix}`;
}

// Build clarification from candidate ambiguity
export function buildClarificationFromAmbiguity(input: {
  candidateId: string;
  ambiguityType: 'entity_match' | 'date_uncertain' | 'conflicting' | 'incomplete';
  description: string;
  entityOptions?: Array<{ entityId: string; label: string; confidence?: number }>;
}): ClarificationRequest {
  const { candidateId, ambiguityType, description, entityOptions } = input;

  // Map ambiguity type to question type
  const questionType: ClarificationQuestionType =
    ambiguityType === 'entity_match'
      ? 'entity_match'
      : ambiguityType === 'date_uncertain'
        ? 'date_confirm'
        : 'entity_match'; // Default for conflicting/incomplete

  // Build options from entity matches
  const options: ClarificationOption[] = (entityOptions || []).map((opt) => ({
    optionId: generateOptionId(),
    label: opt.label,
    entityId: opt.entityId,
    confidence: opt.confidence,
  }));

  return {
    clarificationId: generateClarificationId(),
    candidateId,
    question: description.endsWith('?') ? description : `${description}?`,
    questionType,
    options,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
}
