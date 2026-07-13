import { z } from "zod";

const uuid = z.string().uuid();
const idempotencyKey = uuid;
const businessDate = z.string().date();
const hasAtMostFourDecimals = (value: number) =>
  Math.abs(value * 10_000 - Math.round(value * 10_000)) < 1e-7;
const physicalQty = z.coerce
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999)
  .refine(hasAtMostFourDecimals, "Quantity supports at most four decimal places");

export const RECOUNT_TYPES = ["start_of_day", "end_of_day", "cycle"] as const;
export const RECOUNT_ADJUSTMENT_REASONS = [
  "counting_error",
  "unrecorded_movement",
  "spoilage",
  "damage",
  "theft_or_loss",
  "found_stock",
  "unit_conversion",
  "other",
] as const;

export const recountOpenSchema = z
  .object({
    branchId: uuid,
    businessDate,
    type: z.enum(RECOUNT_TYPES),
    idempotencyKey,
    itemIds: z.array(uuid).max(250).default([]),
  })
  .superRefine((value, ctx) => {
    const unique = new Set(value.itemIds);
    if (unique.size !== value.itemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemIds"],
        message: "Items must be unique",
      });
    }
    if (value.type === "cycle" && value.itemIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemIds"],
        message: "Cycle counts require at least one item",
      });
    }
    if (value.type !== "cycle" && value.itemIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemIds"],
        message: "Full recounts select their complete item set automatically",
      });
    }
  });

export const cycleCountSchema = recountOpenSchema.refine((value) => value.type === "cycle", {
  path: ["type"],
  message: "Cycle count type is required",
});

export const recountSubmitSchema = z.object({
  sessionId: uuid,
  idempotencyKey,
  lines: z
    .array(z.object({ lineId: uuid, physicalQty }))
    .min(1)
    .max(250)
    .refine((lines) => new Set(lines.map((line) => line.lineId)).size === lines.length, {
      message: "Every recount line may be submitted only once",
    }),
});

export const varianceAdjustmentSchema = z.object({
  sessionId: uuid,
  reasonType: z.enum(RECOUNT_ADJUSTMENT_REASONS),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey,
});

export const dayCloseSchema = z.object({
  branchId: uuid,
  businessDate,
  idempotencyKey,
});

export const dayReopenSchema = dayCloseSchema.extend({
  reason: z.string().trim().min(3).max(1000),
});
