import { z } from "zod";

export const recipeScopeSchema = z.enum(["production", "sale_product", "sale_variant", "modifier"]);
export type RecipeScope = z.infer<typeof recipeScopeSchema>;

export const recipeCreateSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a recipe name").max(160, "Recipe name is too long"),
    scope: recipeScopeSchema,
    outputItemId: z.string().uuid().optional(),
    targetId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "production" && !value.outputItemId) {
      ctx.addIssue({ code: "custom", path: ["outputItemId"], message: "Choose an output item" });
    }
    if (value.scope !== "production" && !value.targetId) {
      ctx.addIssue({ code: "custom", path: ["targetId"], message: "Choose a recipe target" });
    }
  });

export const recipeVersionSchema = z.object({
  recipeId: z.string().uuid(),
  outputQty: z.coerce.number().positive("Output quantity must be greater than zero"),
  outputUnitId: z.string().uuid("Choose an output unit"),
  expectedYieldPct: z.coerce.number().positive().max(100).default(100),
  expectedWastePct: z.coerce.number().min(0).max(99.9999).default(0),
  effectiveDate: z.string().date().optional(),
  prepNotes: z.string().trim().max(2000).nullish(),
});

export const recipeLineSchema = z.object({
  recipeVersionId: z.string().uuid(),
  inputItemId: z.string().uuid("Choose an input item"),
  qty: z.coerce.number().positive("Quantity must be greater than zero"),
});
