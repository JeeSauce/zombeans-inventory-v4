"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createProductionTemplateAction,
  type ProductionActionState,
} from "@/app/(app)/production/actions";
import {
  productionStatusVariant,
  type ProductionStatus,
} from "@/lib/production/status";
import { formatHumanDateTime } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface ProductionTemplateRow {
  id: string;
  name: string;
  recipeName: string;
  outputName: string;
  outputSku: string;
  defaultBatchMultiplier: number;
  defaultExpiryDays: number | null;
}

export interface ProductionOrderRow {
  id: string;
  reference: string;
  templateName: string;
  outputName: string;
  outputSku: string;
  status: ProductionStatus;
  plannedOutputQty: number;
  actualOutputQty: number | null;
  unitCode: string;
  createdAt: string;
}

export interface ProductionRecipeOption {
  id: string;
  label: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Creating…" : "Create template"}</Button>;
}

function CreateTemplateDialog({ recipes }: { recipes: ProductionRecipeOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ProductionActionState, FormData>(
    createProductionTemplateAction,
    {},
  );
  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state.info]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="size-4" /> New template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New production template</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="template-name">Template name</Label>
            <Input id="template-name" name="name" required maxLength={160} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-recipe">Active production recipe</Label>
            <select
              id="template-recipe"
              name="recipeId"
              className={selectClass}
              required
              defaultValue=""
            >
              <option value="" disabled>
                Choose a recipe…
              </option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="template-multiplier">Default batches</Label>
              <Input
                id="template-multiplier"
                name="defaultBatchMultiplier"
                type="number"
                min="0.0001"
                step="0.0001"
                defaultValue="1"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-expiry">Shelf life (days)</Label>
              <Input
                id="template-expiry"
                name="defaultExpiryDays"
                type="number"
                min="0"
                max="3650"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-instructions">Instructions (optional)</Label>
            <Input id="template-instructions" name="instructions" maxLength={2000} />
          </div>
          <div className="flex justify-end">
            <SubmitButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProductionListClient({
  orders,
  templates,
  recipeOptions,
  canCreate,
}: {
  orders: ProductionOrderRow[];
  templates: ProductionTemplateRow[];
  recipeOptions: ProductionRecipeOption[];
  canCreate: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        {canCreate && recipeOptions.length > 0 && <CreateTemplateDialog recipes={recipeOptions} />}
        {canCreate && templates.length > 0 && (
          <Button asChild>
            <Link href="/production/new">
              <Plus className="size-4" /> New production order
            </Link>
          </Button>
        )}
      </div>

      {templates.length === 0 && (
        <Alert>
          <AlertDescription>
            {canCreate
              ? recipeOptions.length > 0
                ? "Create a template from an active production recipe before scheduling an order."
                : "Activate a production recipe before creating a production template."
              : "No active production templates are available."}
          </AlertDescription>
        </Alert>
      )}

      {templates.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{template.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-1 text-sm">
                <p>{template.recipeName}</p>
                <p className="font-data text-xs">
                  {template.outputName} · {template.outputSku}
                </p>
                <p>
                  Default {template.defaultBatchMultiplier} batch
                  {template.defaultBatchMultiplier === 1 ? "" : "es"}
                  {template.defaultExpiryDays === null
                    ? ""
                    : ` · ${template.defaultExpiryDays} day shelf life`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No production orders yet. {canCreate ? "Create one when the next batch is ready." : ""}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Template / output</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-data font-medium">
                    <Link href={`/production/${order.id}`} className="hover:underline">
                      {order.reference}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <p>{order.templateName}</p>
                    <p className="font-data text-muted-foreground text-xs">
                      {order.outputName} · {order.outputSku}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={productionStatusVariant(order.status)}>
                      {order.status.replaceAll("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {order.plannedOutputQty} {order.unitCode}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {order.actualOutputQty === null ? "—" : `${order.actualOutputQty} ${order.unitCode}`}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {formatHumanDateTime(order.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
