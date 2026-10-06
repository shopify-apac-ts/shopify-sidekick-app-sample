import { z } from "zod";

export const lineSchema = z.object({
  sku: z.string().min(1).max(40),
  quantity: z.number().int().positive().max(10000),
  reason: z.string().trim().min(1).max(500),
});
export const planSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000),
  budget: z.number().int().positive().max(200000),
  items: z.array(lineSchema).min(1).max(20),
});
export type Plan = z.infer<typeof planSchema>;

export const submissionSchema = z.object({
  plan: planSchema,
  revision: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});
export type Submission = z.infer<typeof submissionSchema>;

export class BusinessError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

export function formatYen(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
}
