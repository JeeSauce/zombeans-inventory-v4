"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createProductionOrderAction,
  type ProductionActionState,
} from "@/app/(app)/production/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ProductionTemplateOption {
  id: string;
  label: string;
  defaultBatchMultiplier: number;
  instructions: string | null;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Planning…" : "Create production order"}</Button>;
}

export function NewProductionOrderForm({
  templates,
  idempotencyKey,
}: {
  templates: ProductionTemplateOption[];
  idempotencyKey: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState<ProductionActionState, FormData>(
    createProductionOrderAction,
    {},
  );
  useEffect(() => {
    if (state.info) toast.success(state.info);
    if (state.orderId) router.push(`/production/${state.orderId}`);
  }, [router, state.info, state.orderId]);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Plan a production batch</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="templateId">Production template</Label>
            <select
              id="templateId"
              name="templateId"
              className={selectClass}
              required
              defaultValue=""
            >
              <option value="" disabled>
                Choose a template…
              </option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="batchMultiplier">Batch multiplier</Label>
            <Input
              id="batchMultiplier"
              name="batchMultiplier"
              type="number"
              min="0.0001"
              step="0.0001"
              defaultValue={templates[0]?.defaultBatchMultiplier ?? 1}
              required
            />
            <p className="text-muted-foreground text-xs">
              Planned inputs and output are frozen from the active recipe version at this scale.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" name="notes" maxLength={1000} />
          </div>
          <div className="flex justify-end">
            <SubmitButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
