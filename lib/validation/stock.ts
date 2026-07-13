import { z } from "zod";

const uuid = z.string().uuid();
const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );
const positiveQty = z.coerce
  .number()
  .finite()
  .positive("Quantity must be greater than zero")
  .max(9999999999);
const nonnegativeQty = z.coerce.number().finite().min(0).max(9999999999);

export const stockInLineSchema = z.object({
  itemId: uuid,
  qty: positiveQty,
  lotNumber: nullableText(80),
  expirationDate: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().date().nullable().optional(),
  ),
});

export const stockInSchema = z.object({
  branchId: uuid,
  reason: z.string().trim().min(3).max(240),
  notes: nullableText(1000),
  idempotencyKey: uuid,
  lines: z.array(stockInLineSchema).min(1).max(100),
});

export const stockOutLineSchema = z.object({ itemId: uuid, qty: positiveQty });

export const stockOutSchema = z.object({
  branchId: uuid,
  reason: z.string().trim().min(3).max(240),
  notes: nullableText(1000),
  idempotencyKey: uuid,
  lines: z.array(stockOutLineSchema).min(1).max(100),
});

export const stockRequestCreateSchema = z.object({
  requestingBranchId: uuid,
  notes: nullableText(1000),
  idempotencyKey: uuid,
  lines: z
    .array(z.object({ itemId: uuid, qty: positiveQty }))
    .min(1)
    .max(100),
});

export const stockRequestReviewSchema = z.object({
  requestId: uuid,
  decision: z.enum(["approve", "reject"]),
  reviewNotes: nullableText(1000),
  lines: z.array(z.object({ lineId: uuid, approvedQty: nonnegativeQty })).max(100),
});

export const transferPrepareSchema = z.object({
  sourceBranchId: uuid,
  destBranchId: uuid,
  stockRequestId: uuid.nullable().optional(),
  notes: nullableText(1000),
  idempotencyKey: uuid,
  lines: z
    .array(z.object({ itemId: uuid, qty: positiveQty }))
    .min(1)
    .max(100),
});

export const transferIdSchema = uuid;

export const transferReceiveSchema = z.object({
  transferId: uuid,
  idempotencyKey: uuid,
  discrepancyReason: nullableText(1000),
  lines: z
    .array(
      z.object({
        lineId: uuid,
        receivedQty: nonnegativeQty,
        rejectedQty: nonnegativeQty,
        damagedQty: nonnegativeQty,
        missingQty: nonnegativeQty,
      }),
    )
    .min(1)
    .max(100),
});

export const discrepancyResolutionSchema = z.object({
  discrepancyId: uuid,
  resolution: z.string().trim().min(3).max(1000),
});
