"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  cancelProductionAction,
  confirmProductionAction,
  recordProductionActualsAction,
  startProductionAction,
  type ProductionActionState,
} from "@/app/(app)/production/actions";
import { formatHumanDate, formatHumanDateTime } from "@/lib/format";
import {
  productionStatusVariant,
  type ProductionStatus,
} from "@/lib/production/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export interface ProductionDetail {
  id: string;
  reference: string;
  templateName: string;
  recipeVersion: number;
  outputName: string;
  outputSku: string;
  unitCode: string;
  status: ProductionStatus;
  plannedOutputQty: number;
  actualOutputQty: number | null;
  outputLotNumber: string | null;
  productionDate: string | null;
  expirationDate: string | null;
  notes: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
}

export interface ProductionInputRow {
  id: string;
  itemName: string;
  itemSku: string;
  unitCode: string;
  plannedQty: number;
  actualConsumedQty: number;
  wasteQty: number;
  notes: string | null;
}

function SubmitActualsButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Submitting…" : "Submit for confirmation"}</Button>;
}

function LifecycleButton({
  label,
  pendingLabel,
  icon,
  variant = "default",
  action,
}: {
  label: string;
  pendingLabel: string;
  icon: React.ReactNode;
  variant?: "default" | "outline" | "destructive";
  action: () => Promise<ProductionActionState>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await action();
          if (result.error) toast.error(result.error);
          else if (result.info) toast.success(result.info);
        })
      }
    >
      {icon} {pending ? pendingLabel : label}
    </Button>
  );
}

export function ProductionDetailClient({
  order,
  inputs,
  warnings,
  canRecord,
  canConfirm,
  canCancel,
  defaultProductionDate,
  defaultExpirationDate,
}: {
  order: ProductionDetail;
  inputs: ProductionInputRow[];
  warnings: string[];
  canRecord: boolean;
  canConfirm: boolean;
  canCancel: boolean;
  defaultProductionDate: string;
  defaultExpirationDate: string;
}) {
  const [state, formAction] = useActionState<ProductionActionState, FormData>(
    recordProductionActualsAction.bind(null, order.id),
    {},
  );
  useEffect(() => {
    if (state.info) toast.success(state.info);
  }, [state.info]);

  const canEditActuals = canRecord && order.status === "in_progress";
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={productionStatusVariant(order.status)}>
              {order.status.replaceAll("_", " ")}
            </Badge>
            <span className="text-muted-foreground text-sm">
              Recipe version {order.recipeVersion} · planned {order.plannedOutputQty} {order.unitCode}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {canRecord && order.status === "draft" && (
              <LifecycleButton
                label="Start production"
                pendingLabel="Starting…"
                icon={<Play className="size-4" />}
                action={() => startProductionAction(order.id)}
              />
            )}
            {canConfirm && order.status === "awaiting_confirmation" && (
              <LifecycleButton
                label="Confirm and post"
                pendingLabel="Posting…"
                icon={<CheckCircle2 className="size-4" />}
                action={() => confirmProductionAction(order.id)}
              />
            )}
            {canCancel && !["completed", "cancelled"].includes(order.status) && (
              <LifecycleButton
                label="Cancel"
                pendingLabel="Cancelling…"
                icon={<XCircle className="size-4" />}
                variant="destructive"
                action={() => cancelProductionAction(order.id)}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {warnings.map((warning) => (
        <Alert key={warning}>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      {order.status === "awaiting_confirmation" && !canConfirm && (
        <Alert>
          <AlertDescription>
            Submitted. A Branch Manager or Super Admin must confirm before inventory changes.
          </AlertDescription>
        </Alert>
      )}
      {order.status === "completed" && (
        <Alert>
          <AlertDescription>
            Completed {order.confirmedAt ? formatHumanDateTime(order.confirmedAt) : ""}. Inputs,
            waste, output lot, balances, and ledger entries posted atomically.
          </AlertDescription>
        </Alert>
      )}

      <form action={formAction} className="space-y-6">
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Inputs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Consumed</TableHead>
                    <TableHead className="text-right">Waste</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inputs.map((input) => (
                    <TableRow key={input.id}>
                      <TableCell>
                        <p className="font-medium">{input.itemName}</p>
                        <p className="font-data text-muted-foreground text-xs">{input.itemSku}</p>
                      </TableCell>
                      <TableCell className="font-data text-right">
                        {input.plannedQty} {input.unitCode}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEditActuals ? (
                          <Input
                            aria-label={`${input.itemName} consumed quantity`}
                            name={`actual_${input.id}`}
                            type="number"
                            min="0"
                            step="0.0001"
                            defaultValue={input.actualConsumedQty || input.plannedQty}
                            className="ml-auto w-28 text-right"
                            required
                          />
                        ) : (
                          <span className="font-data">{input.actualConsumedQty}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEditActuals ? (
                          <Input
                            aria-label={`${input.itemName} waste quantity`}
                            name={`waste_${input.id}`}
                            type="number"
                            min="0"
                            step="0.0001"
                            defaultValue={input.wasteQty}
                            className="ml-auto w-28 text-right"
                            required
                          />
                        ) : (
                          <span className="font-data">{input.wasteQty}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Output batch</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {canEditActuals ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="actualOutputQty">Actual output ({order.unitCode})</Label>
                  <Input
                    id="actualOutputQty"
                    name="actualOutputQty"
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    defaultValue={order.actualOutputQty ?? order.plannedOutputQty}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="outputLotNumber">Batch / lot number</Label>
                  <Input id="outputLotNumber" name="outputLotNumber" maxLength={80} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="productionDate">Production date</Label>
                  <Input
                    id="productionDate"
                    name="productionDate"
                    type="date"
                    defaultValue={defaultProductionDate}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expirationDate">Expiration date</Label>
                  <Input
                    id="expirationDate"
                    name="expirationDate"
                    type="date"
                    defaultValue={defaultExpirationDate}
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Input id="notes" name="notes" maxLength={1000} defaultValue={order.notes ?? ""} />
                </div>
              </>
            ) : (
              <>
                <p>
                  <span className="text-muted-foreground">Actual output:</span>{" "}
                  {order.actualOutputQty ?? "—"} {order.unitCode}
                </p>
                <p>
                  <span className="text-muted-foreground">Batch:</span> {order.outputLotNumber ?? "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Produced:</span>{" "}
                  {order.productionDate ? formatHumanDate(order.productionDate) : "—"}
                </p>
                <p>
                  <span className="text-muted-foreground">Expires:</span>{" "}
                  {order.expirationDate ? formatHumanDate(order.expirationDate) : "—"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        {canEditActuals && (
          <div className="flex justify-end">
            <SubmitActualsButton />
          </div>
        )}
      </form>
    </div>
  );
}
