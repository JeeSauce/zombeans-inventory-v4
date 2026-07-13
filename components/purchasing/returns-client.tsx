"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { createReturnAction, type ReturnActionState } from "@/app/(app)/purchasing/returns/actions";
import { formatHumanDate } from "@/lib/format";
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

export interface SupplierOption {
  id: string;
  name: string;
}

/** Never carries unit_cost or any other cost column — the lot dropdown shows identity + qty only. */
export interface LotOption {
  id: string;
  itemName: string;
  itemSku: string;
  lotNumber: string | null;
  qtyRemaining: number;
}

export interface ReturnRow {
  id: string;
  reference: string;
  status: string;
  createdAt: string;
  supplierName: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" {
  return status === "posted" ? "default" : "outline";
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Posting…" : "Post return"}
    </Button>
  );
}

function LotSelect({ id, lots }: { id: string; lots: LotOption[] }) {
  return (
    <select id={id} name="lotId" className={selectClass} required defaultValue="">
      <option value="" disabled>
        Choose a lot…
      </option>
      {lots.map((l) => (
        <option key={l.id} value={l.id}>
          {l.itemName} · {l.lotNumber ?? "no lot #"} · {l.qtyRemaining} remaining
        </option>
      ))}
    </select>
  );
}

function ReturnLineRow({
  lots,
  onRemove,
  removable,
}: {
  lots: LotOption[];
  onRemove: () => void;
  removable: boolean;
}) {
  const lotFieldId = useId();
  const qtyFieldId = useId();
  const reasonFieldId = useId();
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-2 rounded-md border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={lotFieldId} className="text-xs">
            Lot
          </Label>
          <LotSelect id={lotFieldId} lots={lots} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={qtyFieldId} className="text-xs">
            Qty
          </Label>
          <Input
            id={qtyFieldId}
            name="qty"
            type="number"
            inputMode="decimal"
            step="0.0001"
            min="0.0001"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={reasonFieldId} className="text-xs">
            Reason (optional)
          </Label>
          <Input id={reasonFieldId} name="reason" maxLength={200} />
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mt-6"
        onClick={onRemove}
        disabled={!removable}
        aria-label="Remove line"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

let nextRowKey = 1;

function CreateReturnDialog({
  suppliers,
  lots,
}: {
  suppliers: SupplierOption[];
  lots: LotOption[];
}) {
  const [open, setOpen] = useState(false);
  const [rowKeys, setRowKeys] = useState<string[]>(() => [`row-${nextRowKey++}`]);
  const [state, formAction] = useActionState<ReturnActionState, FormData>(createReturnAction, {});

  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
      setRowKeys([`row-${nextRowKey++}`]);
    }
  }, [state]);

  const addLine = () => setRowKeys((keys) => [...keys, `row-${nextRowKey++}`]);
  const removeLine = (key: string) =>
    setRowKeys((keys) => (keys.length > 1 ? keys.filter((k) => k !== key) : keys));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New supplier return</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="supplierId">Supplier</Label>
            <select
              id="supplierId"
              name="supplierId"
              className={selectClass}
              required
              defaultValue=""
            >
              <option value="" disabled>
                Choose…
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Lines</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="size-3.5" /> Add line
              </Button>
            </div>
            {lots.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No available lots to return. Received stock must be posted before it can be
                returned.
              </p>
            ) : (
              <div className="space-y-2">
                {rowKeys.map((key) => (
                  <ReturnLineRow
                    key={key}
                    lots={lots}
                    onRemove={() => removeLine(key)}
                    removable={rowKeys.length > 1}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Submit />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnsClient({
  suppliers,
  lots,
  returns,
  canCreate,
}: {
  suppliers: SupplierOption[];
  lots: LotOption[];
  returns: ReturnRow[];
  canCreate: boolean;
}) {
  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <CreateReturnDialog suppliers={suppliers} lots={lots} />
        </div>
      )}
      {returns.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No supplier returns yet.{" "}
          {canCreate
            ? "Send received stock back to a supplier to get started."
            : "Ask an admin to record one."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-data font-medium">{r.reference}</TableCell>
                  <TableCell>{r.supplierName}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {formatHumanDate(r.createdAt)}
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
