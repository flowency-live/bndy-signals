import { z } from 'zod';

export const SignalTypeSchema = z.enum([
  'url',
  'text_paste',
  'image',
  'spreadsheet',
  'note',
]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SignalStatusSchema = z.enum([
  'received',
  'extracting',
  'extracted',
  'interpreting',
  'interpreted',
  'pending_review',
  'reviewed',
  'challenged',
]);
export type SignalStatus = z.infer<typeof SignalStatusSchema>;

export const SignalSchema = z.object({
  signalId: z.string().regex(/^sgnl_[a-zA-Z0-9]{8}$/),
  signalType: SignalTypeSchema,

  // Source info
  rawContentS3Key: z.string(),
  sourceUrl: z.string().url().optional(),
  sourceDescription: z.string().optional(),
  submittedBy: z.string().optional(),

  // Metadata
  mimeType: z.string().optional(),
  fileSize: z.number().int().positive().optional(),
  checksum: z.string().optional(),

  // Status
  status: SignalStatusSchema,

  // Timestamps
  receivedAt: z.string().datetime(),
  processedAt: z.string().datetime().optional(),

  // Current interpretation (latest)
  currentInterpretationId: z.string().optional(),
  interpretationCount: z.number().int().nonnegative().default(0),
});

export type Signal = z.infer<typeof SignalSchema>;

export const CreateSignalInputSchema = SignalSchema.pick({
  signalType: true,
  sourceUrl: true,
  sourceDescription: true,
  submittedBy: true,
  mimeType: true,
  fileSize: true,
});

export type CreateSignalInput = z.infer<typeof CreateSignalInputSchema>;
