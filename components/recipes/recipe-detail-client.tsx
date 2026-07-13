"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  activateRecipeVersionAction,
  addRecipeLineAction,
  createRecipeVersionAction,
  removeRecipeLineAction,
  type RecipeActionState,
} from "@/app/(app)/recipes/actions";
import { formatHumanDate, formatPeso } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export interface RecipeInputOption {
  id: string;
  label: string;
  itemType: string;
  unitCode: string;
}

export interface RecipeLineRow {
  id: string;
  itemName: string;
  itemSku: string;
  itemType: string;
  qty: number;
  unitCode: string;
  isPackaging: boolean;
}

export interface RecipeVersionRow {
  id: string;
  versionNumber: number;
  effectiveDate: string;
  outputQty: number;
  outputUnitCode: string;
  expectedYieldPct: number;
  expectedWastePct: number;
  isActive: boolean;
  activatedAt: string | null;
  prepNotes: string | null;
  lines: RecipeLineRow[];
}

export interface RecipeCostBreakdownRow {
  name: string;
  sku: string;
  qty: number;
  unit: string;
  isPackaging: boolean;
  nestedRecipe: boolean;
  sourceUnitCost: number;
  extendedCost: number;
}

export interface RecipeCostResult {
  ingredientCost: number;
  packagingCost: number;
  wasteCost: number;
  totalCost: number;
  effectiveOutputQty: number;
  unitCost: number;
  breakdown: RecipeCostBreakdownRow[];
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? busy : label}</Button>;
}

function CreateVersionDialog({
  recipeId,
  outputUnitId,
  outputUnitCode,
}: {
  recipeId: string;
  outputUnitId: string;
  outputUnitCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<RecipeActionState, FormData>(
    createRecipeVersionAction.bind(null, recipeId),
    {},
  );
  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New version
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create draft version</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <input type="hidden" name="outputUnitId" value={outputUnitId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="outputQty">Expected output ({outputUnitCode})</Label>
              <Input
                id="outputQty"
                name="outputQty"
                type="number"
                min="0.0001"
                step="0.0001"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="effectiveDate">Effective date</Label>
              <Input id="effectiveDate" name="effectiveDate" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedYieldPct">Expected yield %</Label>
              <Input
                id="expectedYieldPct"
                name="expectedYieldPct"
                type="number"
                min="0.0001"
                max="100"
                step="0.0001"
                defaultValue="100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedWastePct">Expected waste %</Label>
              <Input
                id="expectedWastePct"
                name="expectedWastePct"
                type="number"
                min="0"
                max="99.9999"
                step="0.0001"
                defaultValue="0"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prepNotes">Preparation notes</Label>
            <textarea
              id="prepNotes"
              name="prepNotes"
              maxLength={2000}
              rows={4}
              className={`${selectClass} h-auto py-2`}
            />
          </div>
          <div className="flex justify-end">
            <SubmitButton label="Create version" busy="Creating…" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddLineDialog({
  recipeId,
  versionId,
  inputs,
}: {
  recipeId: string;
  versionId: string;
  inputs: RecipeInputOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<RecipeActionState, FormData>(
    addRecipeLineAction.bind(null, recipeId, versionId),
    {},
  );
  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-3.5" /> Add input
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add recipe input</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor={`input-${versionId}`}>Input item</Label>
            <select
              id={`input-${versionId}`}
              name="inputItemId"
              className={selectClass}
              required
              defaultValue=""
            >
              <option value="" disabled>
                Choose an input…
              </option>
              {inputs.map((input) => (
                <option key={input.id} value={input.id}>
                  {input.label} · {input.unitCode}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`qty-${versionId}`}>Quantity in base unit</Label>
            <Input
              id={`qty-${versionId}`}
              name="qty"
              type="number"
              min="0.0001"
              step="0.0001"
              required
            />
          </div>
          <div className="flex justify-end">
            <SubmitButton label="Add input" busy="Adding…" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveLineButton({
  recipeId,
  versionId,
  lineId,
}: {
  recipeId: string;
  versionId: string;
  lineId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label="Remove recipe input"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeRecipeLineAction(recipeId, versionId, lineId);
          if (result.error) toast.error(result.error);
          else if (result.info) toast.success(result.info);
        })
      }
    >
      <Trash2 className="size-4" />
    </Button>
  );
}

function ActivateButton({ recipeId, versionId }: { recipeId: string; versionId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Activate this version? Its composition will become immutable."))
          return;
        startTransition(async () => {
          const result = await activateRecipeVersionAction(recipeId, versionId);
          if (result.error) toast.error(result.error);
          else if (result.info) toast.success(result.info);
        });
      }}
    >
      <CheckCircle2 className="size-4" /> {pending ? "Activating…" : "Activate version"}
    </Button>
  );
}

function CostBreakdown({ cost }: { cost: RecipeCostResult }) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Ingredients", cost.ingredientCost],
          ["Packaging", cost.packagingCost],
          ["Expected waste", cost.wasteCost],
          ["Batch total", cost.totalCost],
          ["Effective output", cost.effectiveOutputQty],
          ["Unit cost", cost.unitCost],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-muted/50 rounded-md p-3">
            <div className="text-muted-foreground text-xs">{label}</div>
            <div className="font-data mt-1 font-medium">
              {label === "Effective output" ? Number(value) : formatPeso(Number(value))}
            </div>
          </div>
        ))}
      </div>
      {cost.breakdown.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Input</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Extended</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cost.breakdown.map((line) => (
                <TableRow key={`${line.sku}-${line.name}`}>
                  <TableCell>
                    <div className="font-medium">{line.name}</div>
                    <div className="font-data text-muted-foreground text-xs">{line.sku}</div>
                  </TableCell>
                  <TableCell className="font-data">
                    {line.qty} {line.unit}
                  </TableCell>
                  <TableCell>
                    {line.nestedRecipe
                      ? "Nested recipe"
                      : line.isPackaging
                        ? "Packaging"
                        : "Inventory cost"}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {formatPeso(line.sourceUnitCost)}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {formatPeso(line.extendedCost)}
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

export function RecipeDetailClient({
  recipeId,
  kind,
  outputUnitId,
  outputUnitCode,
  versions,
  inputs,
  canWrite,
  canReadCost,
  currentCost,
  costError,
}: {
  recipeId: string;
  kind: "production" | "sale" | "modifier";
  outputUnitId: string;
  outputUnitCode: string;
  versions: RecipeVersionRow[];
  inputs: RecipeInputOption[];
  canWrite: boolean;
  canReadCost: boolean;
  currentCost: RecipeCostResult | null;
  costError: string | null;
}) {
  const allowedInputs =
    kind === "production"
      ? inputs
      : inputs.filter((input) =>
          ["sub_product", "portioned_product", "packaging", "container"].includes(input.itemType),
        );

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex justify-end">
          <CreateVersionDialog
            recipeId={recipeId}
            outputUnitId={outputUnitId}
            outputUnitCode={outputUnitCode}
          />
        </div>
      )}

      {canReadCost && costError && (
        <Alert variant="destructive">
          <AlertDescription>{costError}</AlertDescription>
        </Alert>
      )}
      {canReadCost && currentCost && <CostBreakdown cost={currentCost} />}

      {versions.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No versions yet.{" "}
          {canWrite
            ? "Create a draft version to add recipe inputs."
            : "An editor has not created one yet."}
        </div>
      ) : (
        versions.map((version) => {
          const locked = version.activatedAt !== null;
          return (
            <section key={version.id} className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-xl">Version {version.versionNumber}</h2>
                    {version.isActive ? (
                      <Badge>active</Badge>
                    ) : locked ? (
                      <Badge variant="secondary">retired</Badge>
                    ) : (
                      <Badge variant="outline">draft</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {version.outputQty} {version.outputUnitCode} output · {version.expectedYieldPct}
                    % yield · {version.expectedWastePct}% waste · effective{" "}
                    {formatHumanDate(version.effectiveDate)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {locked && (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <LockKeyhole className="size-3.5" /> Immutable
                    </span>
                  )}
                  {canWrite && !locked && (
                    <AddLineDialog
                      recipeId={recipeId}
                      versionId={version.id}
                      inputs={allowedInputs}
                    />
                  )}
                  {canWrite && canReadCost && !locked && version.lines.length > 0 && (
                    <ActivateButton recipeId={recipeId} versionId={version.id} />
                  )}
                </div>
              </div>
              {version.prepNotes && (
                <p className="text-muted-foreground bg-muted/50 rounded-md p-3 text-sm">
                  {version.prepNotes}
                </p>
              )}
              {version.lines.length === 0 ? (
                <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                  No inputs in this version.
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Input</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        {canWrite && !locked && <TableHead className="w-12" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {version.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            <div className="font-medium">{line.itemName}</div>
                            <div className="font-data text-muted-foreground text-xs">
                              {line.itemSku}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {line.isPackaging ? "packaging" : line.itemType.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-data text-right">
                            {line.qty} {line.unitCode}
                          </TableCell>
                          {canWrite && !locked && (
                            <TableCell>
                              <RemoveLineButton
                                recipeId={recipeId}
                                versionId={version.id}
                                lineId={line.id}
                              />
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
