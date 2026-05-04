import { z } from 'zod';
import { ClaimSchema } from './claim';

export const InterpretationStatusSchema = z.enum([
  'draft',
  'pending_review',
  'accepted',
  'challenged',
  'superseded',
  'parse_failed',
]);
export type InterpretationStatus = z.infer<typeof InterpretationStatusSchema>;

export const ExtractedDateSchema = z.object({
  raw: z.string(),
  parsed: z.string(),
  confidence: z.enum(['certain', 'inferred']),
  inferenceReason: z.string().optional(),
});
export type ExtractedDate = z.infer<typeof ExtractedDateSchema>;

export const TableSchema = z.object({
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())),
  source: z.enum(['html', 'spreadsheet', 'ocr']),
});
export type Table = z.infer<typeof TableSchema>;

export const ExtractionErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  source: z.string().optional(),
});
export type ExtractionError = z.infer<typeof ExtractionErrorSchema>;

export const DeterministicExtractionSchema = z.object({
  rawText: z.string().optional(),
  tables: z.array(TableSchema).optional(),
  dates: z.array(ExtractedDateSchema).optional(),
  urls: z.array(z.string()).optional(),
  ocrText: z.string().optional(),
  errors: z.array(ExtractionErrorSchema).optional(),
  metadata: z
    .object({
      title: z.string().optional(),
      source: z.string().optional(),
      extractedAt: z.string().datetime(),
    })
    .optional(),
});
export type DeterministicExtraction = z.infer<typeof DeterministicExtractionSchema>;

export const LLMInterpretationSchema = z.object({
  modelUsed: z.string(),
  modelProvider: z.string(),
  promptVersion: z.string(),
  reasoning: z.string(),
  rawResponse: z.string().optional(),
});
export type LLMInterpretation = z.infer<typeof LLMInterpretationSchema>;

export const SourceCostSchema = z.object({
  modelCost: z.number().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  runtimeMs: z.number().int().nonnegative(),
});
export type SourceCost = z.infer<typeof SourceCostSchema>;

export const InterpretationSchema = z.object({
  interpretationId: z.string().regex(/^intp_[a-zA-Z0-9]{8}$/),
  signalId: z.string().regex(/^sgnl_[a-zA-Z0-9]{8}$/),
  version: z.number().int().positive(),

  // Extraction results
  deterministicExtraction: DeterministicExtractionSchema,

  // LLM interpretation
  llmInterpretation: LLMInterpretationSchema,

  // Cost tracking (REQUIRED)
  sourceCost: SourceCostSchema,

  // Output - claims
  claims: z.array(ClaimSchema),
  uncertainties: z.array(z.string()),
  invalidClaimCount: z.number().int().nonnegative().optional(),
  parseError: z.string().optional(),

  // Output - AI-native event candidates (proposed by LLM)
  eventCandidateIds: z.array(z.string().regex(/^cand_[a-zA-Z0-9]{8}$/)).optional(),

  // NOTE: clarificationRequestIds removed until Phase C implements proper persistence
  // See next-5-phases.md for clarification model design

  // Lifecycle
  status: InterpretationStatusSchema,
  createdAt: z.string().datetime(),
  supersededBy: z.string().optional(),
  supersededAt: z.string().datetime().optional(),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;
