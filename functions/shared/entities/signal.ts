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
  'failed',
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

  // Failure info (if status === 'failed')
  failedAt: z.string().datetime().optional(),
  failedStep: z.enum(['extraction', 'interpretation']).optional(),
  failureReason: z.string().optional(),
});

export type Signal = z.infer<typeof SignalSchema>;

export const CreateSignalInputSchema = z.object({
  signalType: SignalTypeSchema,

  // Content - one of these is required depending on signalType
  content: z.string().optional(),           // For text_paste, note
  sourceUrl: z.string().url().optional(),   // For url type
  base64Content: z.string().optional(),     // For image, spreadsheet uploads

  // Optional metadata
  sourceDescription: z.string().optional(),
  submittedBy: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
}).refine(
  (data) => {
    // Validate required content based on signalType
    if (data.signalType === 'url') {
      return !!data.sourceUrl;
    }
    if (data.signalType === 'text_paste' || data.signalType === 'note') {
      return !!data.content;
    }
    if (data.signalType === 'image' || data.signalType === 'spreadsheet') {
      return !!data.base64Content || !!data.sourceUrl;
    }
    return true;
  },
  {
    message: 'Content required: sourceUrl for URL type, content for text/note, base64Content or sourceUrl for image/spreadsheet',
  }
);

export type CreateSignalInput = z.infer<typeof CreateSignalInputSchema>;
