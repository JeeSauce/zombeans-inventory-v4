import { z } from "zod";

export const OFFLINE_DRAFT_TYPES = ["recount", "production"] as const;
export const OFFLINE_DRAFT_STATES = [
  "draft",
  "queued",
  "syncing",
  "review_required",
  "synced",
  "error",
] as const;
export const LOYVERSE_ENTITY_TYPES = ["item", "variant", "modifier"] as const;
export const POS_MOVEMENT_TYPES = ["sale", "refund"] as const;

const quantity = z.coerce
  .number()
  .finite()
  .nonnegative()
  .max(9_999_999_999)
  .refine((value) => Math.round(value * 10_000) / 10_000 === value, {
    message: "Quantity supports at most four decimal places",
  });
const positiveQuantity = quantity.refine((value) => value > 0, {
  message: "Quantity must be greater than zero",
});
const safeOptionalText = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.string().trim().max(1_000).nullable(),
);

export const offlineRecountLineSchema = z.object({
  itemId: z.string().uuid(),
  itemName: z.string().trim().min(1).max(200).optional(),
  sku: z.string().trim().min(1).max(100).optional(),
  unitCode: z.string().trim().min(1).max(30).optional(),
  physicalQty: quantity,
});

export const offlineRecountPayloadSchema = z.object({
  branchId: z.string().uuid(),
  branchName: z.string().trim().min(1).max(200).optional(),
  businessDate: z.string().date(),
  reason: z.string().trim().min(3).max(1_000),
  lines: z.array(offlineRecountLineSchema).min(1).max(100),
});

export const offlineProductionInputSchema = z.object({
  id: z.string().uuid(),
  itemName: z.string().trim().min(1).max(200).optional(),
  unitCode: z.string().trim().min(1).max(30).optional(),
  actualConsumedQty: quantity,
  wasteQty: quantity,
  notes: safeOptionalText,
});

export const offlineProductionPayloadSchema = z
  .object({
    productionOrderId: z.string().uuid(),
    productionOrderReference: z.string().trim().min(1).max(100).optional(),
    actualOutputQty: positiveQuantity,
    outputLotNumber: z.string().trim().min(1).max(160),
    productionDate: z.string().date(),
    expirationDate: z.string().date(),
    notes: safeOptionalText,
    inputs: z.array(offlineProductionInputSchema).min(1).max(100),
  })
  .refine((value) => value.expirationDate >= value.productionDate, {
    path: ["expirationDate"],
    message: "Expiration cannot be before the production date",
  });

const draftBaseSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  label: z.string().trim().min(1).max(200),
  snapshotAt: z.string().datetime({ offset: true }),
  clientCreatedAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  state: z.enum(OFFLINE_DRAFT_STATES),
  serverReference: z.string().trim().min(1).max(100).nullish(),
  lastError: z.string().trim().min(1).max(1_000).nullish(),
});

export const offlineDraftSchema = z.discriminatedUnion("type", [
  draftBaseSchema.extend({ type: z.literal("recount"), payload: offlineRecountPayloadSchema }),
  draftBaseSchema.extend({
    type: z.literal("production"),
    payload: offlineProductionPayloadSchema,
  }),
]);

export const offlineDraftSyncSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("recount"),
    id: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    snapshotAt: z.string().datetime({ offset: true }),
    clientCreatedAt: z.string().datetime({ offset: true }),
    payload: offlineRecountPayloadSchema,
  }),
  z.object({
    type: z.literal("production"),
    id: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    snapshotAt: z.string().datetime({ offset: true }),
    clientCreatedAt: z.string().datetime({ offset: true }),
    payload: offlineProductionPayloadSchema,
  }),
]);

export const offlineConflictResolutionSchema = z.object({
  submissionId: z.string().uuid(),
  decision: z.enum(["accept", "reject"]),
  reason: z.string().trim().min(3).max(1_000),
  idempotencyKey: z.string().uuid(),
});

export const barcodeLookupSchema = z.object({
  barcode: z.string().trim().min(3).max(128),
});

export const loyverseMappingSchema = z.object({
  entityType: z.enum(LOYVERSE_ENTITY_TYPES),
  externalId: z.string().trim().min(1).max(200),
  externalName: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().min(1).max(200).nullable(),
  ),
  externalSku: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().min(1).max(100).nullable(),
  ),
  inventoryItemId: z.string().uuid(),
  inventoryQty: positiveQuantity,
  reason: z.string().trim().min(3).max(1_000),
  idempotencyKey: z.string().uuid(),
});

export const loyverseMappingDeactivateSchema = z.object({
  mappingId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1_000),
  idempotencyKey: z.string().uuid(),
});

export const posCsvRowSchema = z.object({
  rowNumber: z.number().int().min(2).max(502),
  externalReference: z.string().trim().min(1).max(160),
  externalLineId: z.string().trim().min(1).max(160),
  occurredAt: z.string().datetime({ offset: true }),
  movementType: z.enum(POS_MOVEMENT_TYPES),
  entityType: z.enum(LOYVERSE_ENTITY_TYPES),
  externalId: z.string().trim().min(1).max(200),
  quantity: positiveQuantity,
});

export const posPreviewSchema = z.object({
  branchId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  idempotencyKey: z.string().uuid(),
  rows: z.array(posCsvRowSchema).min(1).max(500),
});

export const posConfirmSchema = z.object({
  importId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1_000),
  idempotencyKey: z.string().uuid(),
});

export const barcodeLookupResultSchema = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false), barcode: z.string() }),
  z.object({
    found: z.literal(true),
    itemId: z.string().uuid(),
    name: z.string(),
    sku: z.string(),
    barcode: z.string(),
    sourceLabel: z.string(),
    unitCode: z.string(),
  }),
]);

export type OfflineDraft = z.infer<typeof offlineDraftSchema>;
export type OfflineRecountDraft = Extract<OfflineDraft, { type: "recount" }>;
export type OfflineProductionDraft = Extract<OfflineDraft, { type: "production" }>;
export type OfflineDraftSyncInput = z.infer<typeof offlineDraftSyncSchema>;
export type PosCsvRow = z.infer<typeof posCsvRowSchema>;
export type BarcodeLookupResult = z.infer<typeof barcodeLookupResultSchema>;
