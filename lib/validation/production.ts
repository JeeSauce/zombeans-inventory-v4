import { z } from "zod";

const nullableText = (max: number) => z.string().trim().max(max).nullish();
const nonNegativeQty = z.coerce.number().min(0, "Quantity cannot be negative");

export const productionTemplateSchema = z.object({
  name: z.string().trim().min(2, "Enter a template name").max(160, "Template name is too long"),
  recipeId: z.string().uuid("Choose a production recipe"),
  defaultBatchMultiplier: z.coerce.number().positive("Batch multiplier must be positive"),
  defaultExpiryDays: z.coerce.number().int().min(0).max(3650).nullish(),
  instructions: nullableText(2000),
});

export const productionOrderCreateSchema = z.object({
  templateId: z.string().uuid("Choose a production template"),
  batchMultiplier: z.coerce.number().positive("Batch multiplier must be positive"),
  idempotencyKey: z.string().uuid("The production submission token is invalid"),
  notes: nullableText(1000),
});

export const productionActualInputSchema = z.object({
  id: z.string().uuid(),
  actualConsumedQty: nonNegativeQty,
  wasteQty: nonNegativeQty,
  notes: nullableText(500),
});

export const productionActualsSchema = z
  .object({
    productionOrderId: z.string().uuid(),
    actualOutputQty: z.coerce.number().positive("Actual output must be greater than zero"),
    outputLotNumber: z.string().trim().min(1, "Enter an output batch or lot number").max(80),
    productionDate: z.string().date("Enter a valid production date"),
    expirationDate: z.string().date("Enter a valid expiration date"),
    notes: nullableText(1000),
    inputs: z.array(productionActualInputSchema).min(1, "Production requires at least one input"),
  })
  .refine((value) => value.expirationDate >= value.productionDate, {
    path: ["expirationDate"],
    message: "Expiration cannot be before the production date",
  });

export const productionOrderIdSchema = z.string().uuid("Invalid production order");

export type ProductionTemplateInput = z.infer<typeof productionTemplateSchema>;
export type ProductionOrderCreateInput = z.infer<typeof productionOrderCreateSchema>;
export type ProductionActualsInput = z.infer<typeof productionActualsSchema>;
