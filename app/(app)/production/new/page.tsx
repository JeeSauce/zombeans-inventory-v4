import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { can, getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import {
  NewProductionOrderForm,
  type ProductionTemplateOption,
} from "@/components/production/new-production-order-form";

type RawTemplate = {
  id: string;
  name: string;
  default_batch_multiplier: string | number;
  instructions: string | null;
  recipe: { name: string; output_item: { name: string; sku: string } | null } | null;
};

export default async function NewProductionOrderPage() {
  const ctx = await getAuthContext();
  if (!can("production.create", ctx.permissions)) redirect("/production");
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_templates")
    .select(
      "id, name, default_batch_multiplier, instructions, recipe:recipes(name, output_item:inventory_items(name, sku))",
    )
    .eq("active", true)
    .is("deleted_at", null)
    .order("name");
  const templates: ProductionTemplateOption[] = (
    (data as unknown as RawTemplate[] | null) ?? []
  ).map((template) => ({
    id: template.id,
    label: `${template.name} · ${template.recipe?.output_item?.name ?? "Unknown output"}`,
    defaultBatchMultiplier: Number(template.default_batch_multiplier),
    instructions: template.instructions,
  }));
  if (templates.length === 0) redirect("/production");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Production</p>
        <h1 className="font-display mt-1 text-3xl">New production order</h1>
        <p className="text-muted-foreground mt-1">
          The active recipe version, normalized inputs, and historical snapshot are frozen when
          this order is created.
        </p>
      </div>
      <NewProductionOrderForm templates={templates} idempotencyKey={randomUUID()} />
    </div>
  );
}
