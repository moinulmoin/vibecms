import { z } from "zod";

export const apiErrorCodes = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "BILLING_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMIT",
  "VALIDATION_ERROR",
] as const;

export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;