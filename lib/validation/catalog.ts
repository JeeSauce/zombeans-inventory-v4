import { z } from "zod";

/**
 * Catalog Zod schemas — validate identically on the client (RHF) and the server (actions).
 * The string-literal tuples mirror the Postgres enums in migration 0006; keep them in sync.
 */

export const ITEM_TYPES = [
  "drink",
  "food",
  "raw_ingredient",
  "sub_product",
  "portioned_product",
  "packaging",
  "container",
] as const;
export const UNIT_DIMENSIONS = ["mass", "volume", "count"] as const;
export const PRODUCT_KINDS = ["drink", "food"] as const;
export const TAX_MODES = ["none", "inclusive", "exclusive"] as const;
export const MODIFIER_SELECTIONS = ["single", "multi"] as const;
export const MODIFIER_AFFECTS = ["price", "inventory", "both", "none"] as const;
export const BARCODE_SYMBOLOGIES = ["ean13", "ean8", "upca", "code128", "qr", "other"] as const;

export type ItemType = (typeof ITEM_TYPES)[number];
export type TaxMode = (typeof TAX_MODES)[number];

const name = z.string().trim().min(2, "Enter a name").max(120, "Name is too long");
const optionalNonNeg = z.coerce
  .number()
  .nonnegative("Cannot be negative")
  .nullish()
  .transform((v) => (v === undefined ? null : v));

// ── Branches ───────────────────────────────────────────────────────────────
export const branchSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, "Lowercase letters, numbers and hyphens only"),
  name,
  isMain: z.boolean().default(false),
  holdsRawIngredients: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type BranchInput = z.infer<typeof branchSchema>;

// ── Categories ─────────────────────────────────────────────────────────────
export const categorySchema = z.object({
  name,
  itemType: z.enum(ITEM_TYPES),
  parentId: z.string().uuid().nullish(),
  active: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categorySchema>;

// ── Units ──────────────────────────────────────────────────────────────────
export const unitSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9]{1,12}$/, "Short lowercase code"),
  name,
  dimension: z.enum(UNIT_DIMENSIONS),
});
export type UnitInput = z.infer<typeof unitSchema>;

// ── Inventory items ────────────────────────────────────────────────────────
export const inventoryItemSchema = z.object({
  name,
  itemType: z.enum(ITEM_TYPES),
  categoryId: z.string().uuid().nullish(),
  baseUnitId: z.string().uuid("Choose a base unit"),
  purchaseUnitId: z.string().uuid().nullish(),
  lowStockThreshold: optionalNonNeg,
  reorderLevel: optionalNonNeg,
  trackable: z.boolean().default(true),
  batchTracked: z.boolean().default(false),
  expiryTracked: z.boolean().default(false),
  isConsumable: z.boolean().default(true),
  storageNotes: z.string().trim().max(500).nullish(),
});
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;

// ── Products & variants ────────────────────────────────────────────────────
export const productSchema = z.object({
  itemId: z.string().uuid("Choose the underlying item"),
  productKind: z.enum(PRODUCT_KINDS),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

export const productVariantSchema = z.object({
  productId: z.string().uuid(),
  name,
  barcode: z.string().trim().max(64).nullish(),
  isActive: z.boolean().default(true),
});
export type ProductVariantInput = z.infer<typeof productVariantSchema>;

// ── Branch pricing (scenario 19) ───────────────────────────────────────────
export const branchPriceSchema = z
  .object({
    branchId: z.string().uuid("Choose a branch"),
    productId: z.string().uuid().nullish(),
    variantId: z.string().uuid().nullish(),
    price: z.coerce.number().nonnegative("Price cannot be negative"),
    taxMode: z.enum(TAX_MODES).default("none"),
    active: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.productId) !== Boolean(v.variantId), {
    message: "A price targets exactly one of a product or a variant",
    path: ["productId"],
  });
export type BranchPriceInput = z.infer<typeof branchPriceSchema>;

// ── VAT settings (scenario 20) ─────────────────────────────────────────────
export const vatSettingSchema = z.object({
  enabled: z.boolean(),
  rate: z.coerce
    .number()
    .min(0, "Rate cannot be negative")
    .max(1, "Enter the rate as a fraction, e.g. 0.12 for 12%"),
  registeredName: z.string().trim().max(160).nullish(),
  tin: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type VatSettingInput = z.infer<typeof vatSettingSchema>;
