import { z } from "zod";

const name = z.string().trim().min(2, "Enter a name").max(160, "Too long");
const nonNeg = z.coerce.number().nonnegative("Cannot be negative");
const pos = z.coerce.number().positive("Must be greater than zero");

export const supplierSchema = z.object({
  name,
  contactName: z.string().trim().max(120).nullish(),
  contactEmail: z.string().trim().email("Invalid email").max(160).nullish().or(z.literal("")),
  contactPhone: z.string().trim().max(40).nullish(),
  leadTimeDays: z.coerce.number().int().min(0).default(0),
  paymentTerms: z.string().trim().max(120).nullish(),
  active: z.boolean().default(true),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export const supplierItemSchema = z.object({
  supplierId: z.string().uuid(),
  itemId: z.string().uuid("Choose an item"),
  supplierSku: z.string().trim().max(80).nullish(),
  packSize: z.coerce.number().positive().nullish(),
});
export type SupplierItemInput = z.infer<typeof supplierItemSchema>;

export const supplierPriceSchema = z.object({
  supplierItemId: z.string().uuid(),
  price: nonNeg,
  currency: z.string().trim().length(3).default("PHP"),
  effectiveDate: z.string().date().optional(),
});
export type SupplierPriceInput = z.infer<typeof supplierPriceSchema>;

export const poSchema = z.object({
  supplierId: z.string().uuid("Choose a supplier"),
  expectedDate: z.string().date().optional(),
  notes: z.string().trim().max(500).nullish(),
});
export type PoInput = z.infer<typeof poSchema>;

export const poLineSchema = z.object({
  poId: z.string().uuid(),
  itemId: z.string().uuid("Choose an item"),
  unitId: z.string().uuid("Choose a unit"),
  orderedQty: pos,
});
export type PoLineInput = z.infer<typeof poLineSchema>;

export const receiptLineSchema = z.object({
  poLineId: z.string().uuid(),
  deliveredQty: nonNeg,
  acceptedQty: nonNeg,
  rejectedQty: nonNeg.default(0),
  damagedQty: nonNeg.default(0),
  missingQty: nonNeg.default(0),
  expirationDate: z.string().date().optional(),
  lotNumber: z.string().trim().max(60).nullish(),
});
export type ReceiptLineInput = z.infer<typeof receiptLineSchema>;

export const returnLineSchema = z.object({
  itemId: z.string().uuid(),
  lotId: z.string().uuid("Choose a lot"),
  qty: pos,
  reason: z.string().trim().max(200).nullish(),
});
export type ReturnLineInput = z.infer<typeof returnLineSchema>;
