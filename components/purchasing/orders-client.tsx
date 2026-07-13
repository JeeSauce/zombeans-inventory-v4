"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createPoAction, type PoActionState } from "@/app/(app)/purchasing/orders/actions";
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
import { statusBadgeVariant, type PoStatus } from "@/lib/purchasing/po-status";

export { statusBadgeVariant } from "@/lib/purchasing/po-status";
export type { PoStatus } from "@/lib/purchasing/po-status";

export type PaymentStatus =
  "unpaid" | "partially_paid" | "paid" | "overdue" | "cancelled" | "refunded";

export interface SupplierOption {
  id: string;
  name: string;
}

export interface OrderRow {
  id: string;
  reference: string;
  status: PoStatus;
  paymentStatus: PaymentStatus;
  expectedDate: string | null;
  supplierName: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

export function paymentBadgeVariant(
  status: PaymentStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "paid":
      return "default";
    case "overdue":
    case "cancelled":
      return "destructive";
    case "partially_paid":
      return "outline";
    case "refunded":
      return "secondary";
    default:
      return "secondary";
  }
}

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function CreatePoDialog({ suppliers }: { suppliers: SupplierOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<PoActionState, FormData>(createPoAction, {});

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
          <Plus className="size-4" /> New purchase order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
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
            <Label htmlFor="expectedDate">Expected date (optional)</Label>
            <Input id="expectedDate" name="expectedDate" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" name="notes" maxLength={500} />
          </div>
          <div className="flex justify-end">
            <Submit label="Create order" busy="Creating…" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OrdersClient({
  orders,
  suppliers,
  canCreate,
}: {
  orders: OrderRow[];
  suppliers: SupplierOption[];
  canCreate: boolean;
}) {
  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <CreatePoDialog suppliers={suppliers} />
        </div>
      )}
      {orders.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No purchase orders yet.{" "}
          {canCreate
            ? "Create one to start ordering from a supplier."
            : "Ask an admin to create one."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Expected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-data font-medium">
                    <Link href={`/purchasing/orders/${o.id}`} className="hover:underline">
                      {o.reference}
                    </Link>
                  </TableCell>
                  <TableCell>{o.supplierName}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(o.status)}>
                      {o.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={paymentBadgeVariant(o.paymentStatus)}>
                      {o.paymentStatus.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {o.expectedDate ? formatHumanDate(o.expectedDate) : "—"}
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
