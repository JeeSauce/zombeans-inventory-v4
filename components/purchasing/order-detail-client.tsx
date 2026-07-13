"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus, Send, CheckCircle2 } from "lucide-react";
import {
  addPoLineAction,
  submitPoAction,
  approvePoAction,
  setPaymentStatusAction,
  type PoActionState,
} from "@/app/(app)/purchasing/orders/actions";
import {
  statusBadgeVariant,
  paymentBadgeVariant,
  type PoStatus,
  type PaymentStatus,
} from "@/components/purchasing/orders-client";
import { formatPeso, formatHumanDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface InventoryItemOption {
  id: string;
  label: string;
}
export interface UnitOption {
  id: string;
  label: string;
}

export interface PoDetail {
  id: string;
  reference: string;
  supplierName: string;
  status: PoStatus;
  paymentStatus: PaymentStatus;
  expectedDate: string | null;
  notes: string | null;
  /** Omitted (undefined) when the caller lacks cost.read. */
  subtotal?: number;
  total?: number;
}

export interface PoLineRow {
  id: string;
  itemName: string;
  itemSku: string;
  unitCode: string;
  orderedQty: number;
  receivedAcceptedQty: number;
  /** Omitted (undefined) when the caller lacks cost.read. */
  unitCost?: number;
}

const PAYMENT_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
];

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function AddLineDialog({
  poId,
  inventoryItems,
  units,
}: {
  poId: string;
  inventoryItems: InventoryItemOption[];
  units: UnitOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<PoActionState, FormData>(
    addPoLineAction.bind(null, poId),
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
          <Plus className="size-4" /> Add line
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a line</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="itemId">Item</Label>
            <select id="itemId" name="itemId" className={selectClass} required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {inventoryItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="unitId">Unit</Label>
              <select id="unitId" name="unitId" className={selectClass} required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="orderedQty">Ordered qty</Label>
              <Input
                id="orderedQty"
                name="orderedQty"
                type="number"
                step="0.0001"
                min="0.0001"
                required
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            The unit cost is filled in automatically from the supplier&apos;s latest recorded price.
          </p>
          <div className="flex justify-end">
            <Submit label="Add line" busy="Adding…" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitPoButton({ poId }: { poId: string }) {
  const [pending, startTransition] = useTransition();
  const handleClick = () => {
    startTransition(async () => {
      const result = await submitPoAction(poId);
      if (result.error) toast.error(result.error);
      else if (result.info) toast.success(result.info);
    });
  };
  return (
    <Button onClick={handleClick} disabled={pending} variant="outline">
      <Send className="size-4" /> {pending ? "Submitting…" : "Submit for approval"}
    </Button>
  );
}

function ApprovePoButton({ poId }: { poId: string }) {
  const [pending, startTransition] = useTransition();
  const handleClick = () => {
    startTransition(async () => {
      const result = await approvePoAction(poId);
      if (result.error) toast.error(result.error);
      else if (result.info) toast.success(result.info);
    });
  };
  return (
    <Button onClick={handleClick} disabled={pending}>
      <CheckCircle2 className="size-4" /> {pending ? "Approving…" : "Approve"}
    </Button>
  );
}

function PaymentStatusControl({ poId, current }: { poId: string; current: PaymentStatus }) {
  const [pending, startTransition] = useTransition();
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const status = e.target.value;
    startTransition(async () => {
      const result = await setPaymentStatusAction(poId, status);
      if (result.error) toast.error(result.error);
      else if (result.info) toast.success(result.info);
    });
  };
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="paymentStatus" className="text-muted-foreground text-xs">
        Payment status
      </Label>
      <select
        id="paymentStatus"
        className={`${selectClass} w-44`}
        defaultValue={current}
        disabled={pending}
        onChange={handleChange}
      >
        {PAYMENT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function OrderDetailClient({
  po,
  lines,
  inventoryItems,
  units,
  canCreate,
  canApprove,
  canReadCost,
}: {
  po: PoDetail;
  lines: PoLineRow[];
  inventoryItems: InventoryItemOption[];
  units: UnitOption[];
  canCreate: boolean;
  canApprove: boolean;
  canReadCost: boolean;
}) {
  const canAddLine = canCreate && po.status === "draft";
  const canSubmit = canCreate && po.status === "draft" && lines.length > 0;
  const canApproveNow = canApprove && po.status === "submitted";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadgeVariant(po.status)}>{po.status.replace(/_/g, " ")}</Badge>
            <Badge variant={paymentBadgeVariant(po.paymentStatus)}>
              {po.paymentStatus.replace(/_/g, " ")}
            </Badge>
            {po.expectedDate && (
              <span className="text-muted-foreground text-xs">
                Expected {formatHumanDate(po.expectedDate)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSubmit && <SubmitPoButton poId={po.id} />}
            {canApproveNow && <ApprovePoButton poId={po.id} />}
            {canApprove && <PaymentStatusControl poId={po.id} current={po.paymentStatus} />}
          </div>
        </div>
        {po.notes && <p className="text-muted-foreground mt-3 text-sm">{po.notes}</p>}
      </div>

      {canAddLine && (
        <div className="flex justify-end">
          <AddLineDialog poId={po.id} inventoryItems={inventoryItems} units={units} />
        </div>
      )}

      {lines.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No lines yet.{" "}
          {canAddLine
            ? "Add an item to start building this order."
            : "Lines will appear once this order has items."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Received</TableHead>
                {canReadCost && <TableHead className="text-right">Unit cost</TableHead>}
                {canReadCost && <TableHead className="text-right">Line total</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.itemName}</TableCell>
                  <TableCell className="font-data text-muted-foreground text-xs">
                    {l.itemSku}
                  </TableCell>
                  <TableCell className="font-data text-xs">{l.unitCode}</TableCell>
                  <TableCell className="font-data text-right">{l.orderedQty}</TableCell>
                  <TableCell className="font-data text-right">{l.receivedAcceptedQty}</TableCell>
                  {canReadCost && (
                    <TableCell className="font-data text-right">
                      {l.unitCost !== undefined ? formatPeso(l.unitCost) : "—"}
                    </TableCell>
                  )}
                  {canReadCost && (
                    <TableCell className="font-data text-right">
                      {l.unitCost !== undefined ? formatPeso(l.unitCost * l.orderedQty) : "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canReadCost && po.subtotal !== undefined && po.total !== undefined && (
            <div className="flex justify-end gap-6 border-t p-3 text-sm">
              <div className="text-muted-foreground">
                Subtotal{" "}
                <span className="font-data text-foreground ml-1">{formatPeso(po.subtotal)}</span>
              </div>
              <div className="font-medium">
                Total <span className="font-data ml-1">{formatPeso(po.total)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
