"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  productionActualsSchema,
  productionOrderCreateSchema,
  productionOrderIdSchema,
  productionTemplateSchema,
} from "@/lib/validation/production";

export type ProductionActionState = { error?: string; info?: string; orderId?: string };

function cleanError(message: string): string {
  return message.replace(/^.*?:\s*/, "");
}

export async function createProductionTemplateAction(
  _previous: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const { user } = await requirePermission("production.create");
  const parsed = productionTemplateSchema.safeParse({
    name: formData.get("name"),
    recipeId: formData.get("recipeId"),
    defaultBatchMultiplier: formData.get("defaultBatchMultiplier") || 1,
    defaultExpiryDays: formData.get("defaultExpiryDays") || null,
    instructions: formData.get("instructions") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid template" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_templates")
    .insert({
      name: parsed.data.name,
      recipe_id: parsed.data.recipeId,
      default_batch_multiplier: parsed.data.defaultBatchMultiplier,
      default_expiry_days: parsed.data.defaultExpiryDays ?? null,
      instructions: parsed.data.instructions ?? null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: cleanError(error.message) };

  await writeAudit({
    actorId: user.id,
    action: "production.template.created",
    entityType: "production_template",
    entityId: data.id,
    after: { name: parsed.data.name, recipeId: parsed.data.recipeId },
  });
  revalidatePath("/production");
  return { info: `Created ${parsed.data.name}.` };
}

export async function createProductionOrderAction(
  _previous: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const { user } = await requirePermission("production.create");
  const parsed = productionOrderCreateSchema.safeParse({
    templateId: formData.get("templateId"),
    batchMultiplier: formData.get("batchMultiplier"),
    idempotencyKey: formData.get("idempotencyKey"),
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid order" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_production_order", {
    p_template_id: parsed.data.templateId,
    p_batch_multiplier: parsed.data.batchMultiplier,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) return { error: cleanError(error.message) };
  const result = data as { id: string; reference: string; already_exists: boolean };

  if (!result.already_exists) {
    await writeAudit({
      actorId: user.id,
      action: "production.order.created",
      entityType: "production_order",
      entityId: result.id,
      after: { reference: result.reference, templateId: parsed.data.templateId },
    });
  }
  revalidatePath("/production");
  return {
    info: result.already_exists
      ? `${result.reference} already exists.`
      : `Created ${result.reference}.`,
    orderId: result.id,
  };
}

export async function startProductionAction(orderId: string): Promise<ProductionActionState> {
  const parsedId = productionOrderIdSchema.safeParse(orderId);
  if (!parsedId.success) return { error: parsedId.error.issues[0]?.message };
  const { user } = await requirePermission("production.record");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_orders")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      started_by: user.id,
      updated_by: user.id,
    })
    .eq("id", orderId)
    .eq("status", "draft")
    .select("reference")
    .single();
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "production.order.started",
    entityType: "production_order",
    entityId: orderId,
    after: { reference: data.reference },
  });
  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  return { info: `Started ${data.reference}.` };
}

export async function recordProductionActualsAction(
  orderId: string,
  _previous: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const { user } = await requirePermission("production.record");
  const supabase = await createClient();
  const { data: inputRows, error: inputError } = await supabase
    .from("production_order_inputs")
    .select("id")
    .eq("production_order_id", orderId);
  if (inputError || !inputRows?.length) return { error: "Production inputs could not be loaded." };

  const parsed = productionActualsSchema.safeParse({
    productionOrderId: orderId,
    actualOutputQty: formData.get("actualOutputQty"),
    outputLotNumber: formData.get("outputLotNumber"),
    productionDate: formData.get("productionDate"),
    expirationDate: formData.get("expirationDate"),
    notes: formData.get("notes") || null,
    inputs: inputRows.map((input) => ({
      id: input.id,
      actualConsumedQty: formData.get(`actual_${input.id}`),
      wasteQty: formData.get(`waste_${input.id}`) || 0,
      notes: formData.get(`notes_${input.id}`) || null,
    })),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid actuals" };

  const { error } = await supabase.rpc("record_production_actuals", {
    p_production_order_id: orderId,
    p_actual_output_qty: parsed.data.actualOutputQty,
    p_output_lot_number: parsed.data.outputLotNumber,
    p_production_date: parsed.data.productionDate,
    p_expiration_date: parsed.data.expirationDate,
    p_notes: parsed.data.notes ?? null,
    p_inputs: parsed.data.inputs.map((input) => ({
      id: input.id,
      actual_consumed_qty: input.actualConsumedQty,
      waste_qty: input.wasteQty,
      notes: input.notes ?? null,
    })),
  });
  if (error) return { error: cleanError(error.message) };

  await writeAudit({
    actorId: user.id,
    action: "production.order.submitted",
    entityType: "production_order",
    entityId: orderId,
    after: { inputCount: parsed.data.inputs.length, actualOutputQty: parsed.data.actualOutputQty },
  });
  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  return { info: "Production actuals submitted for confirmation." };
}

export async function confirmProductionAction(orderId: string): Promise<ProductionActionState> {
  const parsedId = productionOrderIdSchema.safeParse(orderId);
  if (!parsedId.success) return { error: parsedId.error.issues[0]?.message };
  const { user } = await requirePermission("production.confirm");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_production_completion", {
    p_production_order_id: orderId,
  });
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "production.order.completed",
    entityType: "production_order",
    entityId: orderId,
    after: { outputTransactionId: data },
  });
  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  return { info: "Production completed and inventory posted." };
}

export async function cancelProductionAction(orderId: string): Promise<ProductionActionState> {
  const parsedId = productionOrderIdSchema.safeParse(orderId);
  if (!parsedId.success) return { error: parsedId.error.issues[0]?.message };
  const { user } = await requirePermission("production.create");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_orders")
    .update({ status: "cancelled", updated_by: user.id })
    .eq("id", orderId)
    .in("status", ["draft", "in_progress", "awaiting_confirmation"])
    .select("reference")
    .single();
  if (error) return { error: cleanError(error.message) };
  await writeAudit({
    actorId: user.id,
    action: "production.order.cancelled",
    entityType: "production_order",
    entityId: orderId,
    after: { reference: data.reference },
  });
  revalidatePath(`/production/${orderId}`);
  revalidatePath("/production");
  return { info: `Cancelled ${data.reference}.` };
}
