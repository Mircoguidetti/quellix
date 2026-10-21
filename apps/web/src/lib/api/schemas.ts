import { z } from "zod";

export const labOutcomeSchema = z.object({
  outcome: z.enum(["accept", "reject"]),
  reason: z.string().max(2000).optional(),
});

export const createVideoSchema = z.object({
  rubric_id: z.string().min(1),
  rubric_version: z.number().int().min(1).optional(),
  external_id: z.string().max(200).optional(),
  contributor_ref: z.string().max(200).optional(),
  filename: z.string().min(1).max(300),
  content_type: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
  size_bytes: z.number().int().min(1).max(5_368_709_120),
  lab_outcome: labOutcomeSchema.optional(),
});

export const reviewSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  note: z.string().max(2000).optional(),
});

export const rubricInputSchema = z.object({
  name: z.string().min(1),
  task: z.record(z.string(), z.unknown()),
  checks: z.record(z.string(), z.unknown()),
});

export const videoStatusSchema = z.enum(["awaiting_upload", "queued", "processing", "decided", "failed", "deleted"]);
export const decisionValueSchema = z.enum(["accept", "reject", "review"]);

export const listVideosQuerySchema = z.object({
  status: videoStatusSchema.optional(),
  decision: decisionValueSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateVideoInput = z.infer<typeof createVideoSchema>;
