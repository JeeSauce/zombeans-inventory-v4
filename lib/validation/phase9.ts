import { z } from "zod";
import { ITEM_TYPES } from "@/lib/validation/phase8";

export const OPERATIONAL_REPORT_TYPES = [
  "inventory-balances",
  "stock-movements",
  "production-output",
  "recount-variances",
] as const;
export const FINANCIAL_REPORT_TYPES = ["inventory-valuation", "movement-costs"] as const;
export const REPORT_TYPES = [...OPERATIONAL_REPORT_TYPES, ...FINANCIAL_REPORT_TYPES] as const;
export const EXPORT_FORMATS = ["csv", "excel", "pdf"] as const;
export const RECYCLE_ENTITY_TYPES = [
  "category",
  "inventory_item",
  "supplier",
  "purchase_order",
  "recipe",
  "production_template",
] as const;
export const RETENTION_DEPENDENCY_TYPES = ["ledger", "audit", "legal", "accounting"] as const;

const optionalUuid = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullish(),
);
const optionalItemType = z.preprocess(
  (value) => (value === "" ? null : value),
  z.enum(ITEM_TYPES).nullish(),
);

export const reportFilterSchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
    branchId: optionalUuid,
    categoryId: optionalUuid,
    itemType: optionalItemType,
  })
  .refine((value) => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "End date cannot be before start date",
  })
  .refine(
    (value) =>
      (new Date(`${value.endDate}T00:00:00Z`).getTime() -
        new Date(`${value.startDate}T00:00:00Z`).getTime()) /
        86_400_000 <=
      366,
    { path: ["endDate"], message: "Date range cannot exceed 366 days" },
  );

export const reportRequestSchema = reportFilterSchema.and(
  z.object({ reportType: z.enum(REPORT_TYPES) }),
);
export const exportRequestSchema = reportRequestSchema.and(
  z.object({ format: z.enum(EXPORT_FORMATS) }),
);

export const reportColumnSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "quantity", "money", "date", "datetime", "boolean"]),
});
const reportCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const reportEnvelopeSchema = z.object({
  reportType: z.enum(REPORT_TYPES),
  title: z.string().min(1),
  reportClass: z.enum(["operational", "financial"]),
  generatedAt: z.string().datetime({ offset: true }),
  filters: z.object({
    startDate: z.string().date(),
    endDate: z.string().date(),
    branchId: z.string().uuid().nullable(),
    categoryId: z.string().uuid().nullable(),
    itemType: z.enum(ITEM_TYPES).nullable(),
  }),
  columns: z.array(reportColumnSchema).min(1).max(20),
  rows: z.array(z.record(reportCellSchema)).max(1000),
  summary: z.record(reportCellSchema),
  note: z.string().nullable().optional(),
});

export const recycleCommandSchema = z.object({
  entityType: z.enum(RECYCLE_ENTITY_TYPES),
  entityId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: z.string().uuid(),
});

export const purgeCommandSchema = z.object({
  runKey: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const retentionHoldSchema = recycleCommandSchema.extend({
  dependencyType: z.enum(RETENTION_DEPENDENCY_TYPES),
});

export const releaseRetentionHoldSchema = z.object({
  holdId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: z.string().uuid(),
});

export const recycleBinEntrySchema = z.object({
  entity_type: z.enum(RECYCLE_ENTITY_TYPES),
  entity_id: z.string().uuid(),
  label: z.string(),
  deleted_at: z.string().datetime({ offset: true }),
  deleted_by_name: z.string(),
  purge_at: z.string().datetime({ offset: true }),
  eligible_for_purge: z.boolean(),
  dependency_reason: z.string().nullable(),
});

export const backupRunSchema = z.object({
  reference: z.string(),
  mechanism: z.enum(["managed", "pg_dump", "pitr_test"]),
  status: z.enum(["running", "succeeded", "failed", "verified"]),
  storageProvider: z.string().nullable(),
  encrypted: z.boolean(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  retentionUntil: z.string().date().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
  safeFailureSummary: z.string().nullable(),
});
export const backupStatusSchema = z.object({
  latest: backupRunSchema.nullable(),
  history: z.array(backupRunSchema).max(50),
  policy: z.object({
    managed: z.string(),
    independent: z.string(),
    weekly: z.string(),
    restoreTest: z.string(),
    auditRetention: z.string(),
    ledgerRetention: z.string(),
  }),
});

export type ReportType = (typeof REPORT_TYPES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ReportFilters = z.infer<typeof reportFilterSchema>;
export type ReportEnvelope = z.infer<typeof reportEnvelopeSchema>;
export type ReportColumn = z.infer<typeof reportColumnSchema>;
export type RecycleEntityType = (typeof RECYCLE_ENTITY_TYPES)[number];
export type RecycleBinEntry = z.infer<typeof recycleBinEntrySchema>;
export type BackupStatus = z.infer<typeof backupStatusSchema>;
