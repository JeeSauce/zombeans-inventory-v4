import { z } from "zod";

const uuid = z.string().uuid();
const idempotencyKey = uuid;
const optionalUuid = z.preprocess((value) => (value === "" ? null : value), uuid.nullish());
const optionalText = (max: number) =>
  z.preprocess((value) => (value === "" ? null : value), z.string().trim().max(max).nullish());
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time");
const fourDecimalQty = z.coerce
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999)
  .refine(
    (value) => Math.abs(value * 10_000 - Math.round(value * 10_000)) < 1e-7,
    "Quantity supports at most four decimal places",
  );

export const ITEM_TYPES = [
  "drink",
  "food",
  "raw_ingredient",
  "sub_product",
  "portioned_product",
  "packaging",
  "container",
] as const;
export const CALENDAR_EVENT_TYPES = [
  "operation",
  "popup",
  "production",
  "delivery",
  "recount",
  "other",
] as const;
export const CALENDAR_EVENT_STATUSES = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export const POPUP_STOCK_MOVEMENT_TYPES = ["consumed", "waste", "loss", "gain"] as const;

export const dashboardFilterSchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
    branchId: optionalUuid,
    categoryId: optionalUuid,
    itemType: z.preprocess((value) => (value === "" ? null : value), z.enum(ITEM_TYPES).nullish()),
  })
  .refine((value) => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "End date cannot be before start date",
  })
  .refine(
    (value) =>
      (new Date(value.endDate).getTime() - new Date(value.startDate).getTime()) / 86_400_000 <= 366,
    { path: ["endDate"], message: "Date range cannot exceed 366 days" },
  );

const calendarFields = z.object({
  title: z.string().trim().min(2).max(160),
  description: optionalText(2000),
  location: optionalText(240),
  eventType: z.enum(CALENDAR_EVENT_TYPES),
  branchId: optionalUuid,
  startsAtLocal: localDateTime,
  endsAtLocal: localDateTime,
  idempotencyKey,
});

export const calendarCreateSchema = calendarFields.refine(
  (value) => value.endsAtLocal > value.startsAtLocal,
  {
    path: ["endsAtLocal"],
    message: "Event end must be after its start",
  },
);

export const calendarUpdateSchema = calendarFields
  .extend({
    eventId: uuid,
    expectedVersion: z.coerce.number().int().positive(),
    status: z.enum(CALENDAR_EVENT_STATUSES),
  })
  .refine((value) => value.endsAtLocal > value.startsAtLocal, {
    path: ["endsAtLocal"],
    message: "Event end must be after its start",
  });

export const popupCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    description: optionalText(2000),
    location: optionalText(240),
    startsAtLocal: localDateTime,
    endsAtLocal: localDateTime,
    popupBranchId: uuid,
    returnBranchId: uuid,
    notes: optionalText(1000),
    idempotencyKey,
  })
  .refine((value) => value.endsAtLocal > value.startsAtLocal, {
    path: ["endsAtLocal"],
    message: "Event end must be after its start",
  })
  .refine((value) => value.popupBranchId !== value.returnBranchId, {
    path: ["returnBranchId"],
    message: "Popup and return branches must differ",
  });

export const popupCommandSchema = z.object({
  popupEventId: uuid,
  idempotencyKey,
});
export const popupCancelSchema = popupCommandSchema.extend({
  reason: z.string().trim().min(3).max(1000),
});
export const popupTransferLinkSchema = popupCommandSchema.extend({ transferId: uuid });
export const popupStockMovementLinkSchema = popupCommandSchema.extend({
  stockTxnId: uuid,
  movementType: z.enum(POPUP_STOCK_MOVEMENT_TYPES),
});

export const popupCountLineSchema = z
  .object({
    itemId: uuid,
    unitId: uuid,
    transferredInQty: fourDecimalQty,
    remainingQty: fourDecimalQty,
    returnedQty: fourDecimalQty,
    consumedQty: fourDecimalQty,
    wasteQty: fourDecimalQty,
    lossQty: fourDecimalQty,
    gainQty: fourDecimalQty,
    endingQty: fourDecimalQty,
    notes: optionalText(500),
  })
  .superRefine((value, ctx) => {
    const round = (number: number) => Math.round(number * 10_000) / 10_000;
    if (round(value.remainingQty) !== round(value.returnedQty + value.endingQty)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remainingQty"],
        message: "Remaining must equal returned plus ending quantity",
      });
    }
    if (
      round(value.transferredInQty + value.gainQty) !==
      round(value.consumedQty + value.wasteQty + value.lossQty + value.remainingQty)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transferredInQty"],
        message: "Popup quantities do not reconcile",
      });
    }
  });

export const popupCountSchema = popupCommandSchema.extend({
  lines: z
    .array(popupCountLineSchema)
    .min(1)
    .max(250)
    .refine((lines) => new Set(lines.map((line) => line.itemId)).size === lines.length, {
      message: "Every popup item may appear only once",
    }),
});

export const notificationReceiptSchema = z.object({
  notificationId: uuid,
  acknowledge: z.boolean(),
  idempotencyKey,
});

export const productionFailureSchema = z.object({
  orderId: uuid,
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey,
});

export type DashboardFilters = z.infer<typeof dashboardFilterSchema>;
export type CalendarCreateInput = z.infer<typeof calendarCreateSchema>;
export type CalendarUpdateInput = z.infer<typeof calendarUpdateSchema>;
export type PopupCountInput = z.infer<typeof popupCountSchema>;
