"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus, Tag } from "lucide-react";
import {
  addSupplierItemAction,
  addSupplierPriceAction,
  type DetailActionState,
} from "@/app/(app)/purchasing/suppliers/[id]/actions";
import { formatPeso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export interface SupplierItemRow {
  id: string;
  itemName: string;
  itemSku: string;
  supplierSku: string | null;
  packSize: number | null;
  /** Omitted entirely (undefined) when the caller lacks supplier_price.read; null means no price recorded yet. */
  latestPrice?: { price: number; currency: string; effectiveDate: string } | null;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function LinkItemDialog({
  supplierId,
  inventoryItems,
}: {
  supplierId: string;
  inventoryItems: InventoryItemOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<DetailActionState, FormData>(
    addSupplierItemAction.bind(null, supplierId),
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
          <Plus className="size-4" /> Link item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link an inventory item</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="itemId">Inventory item</Label>
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
              <Label htmlFor="supplierSku">Supplier SKU (optional)</Label>
              <Input id="supplierSku" name="supplierSku" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="packSize">Pack size (optional)</Label>
              <Input id="packSize" name="packSize" type="number" step="0.0001" min="0" />
            </div>
          </div>
          <div className="flex justify-end">
            <Submit label="Link item" pendingLabel="Linking…" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddPriceDialog({
  supplierId,
  supplierItem,
}: {
  supplierId: string;
  supplierItem: SupplierItemRow;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<DetailActionState, FormData>(
    addSupplierPriceAction.bind(null, supplierId),
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
        <Button variant="outline" size="sm">
          <Tag className="size-3.5" /> Add price
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a price for {supplierItem.itemName}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <input type="hidden" name="supplierItemId" value={supplierItem.id} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="price">Price (₱)</Label>
              <Input id="price" name="price" type="number" step="0.01" min="0" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="effectiveDate">Effective date (optional)</Label>
              <Input id="effectiveDate" name="effectiveDate" type="date" />
            </div>
          </div>
          <input type="hidden" name="currency" value="PHP" />
          <div className="flex justify-end">
            <Submit label="Record price" pendingLabel="Saving…" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceCell({
  latestPrice,
}: {
  latestPrice: { price: number; currency: string; effectiveDate: string } | null | undefined;
}) {
  if (!latestPrice) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="text-sm">
      <div className="font-data font-medium">{formatPeso(latestPrice.price)}</div>
      <div className="text-muted-foreground text-xs">since {latestPrice.effectiveDate}</div>
    </div>
  );
}

export function SupplierDetailClient({
  supplierId,
  supplierItems,
  inventoryItems,
  canManageItems,
  canReadPrice,
  canManagePrice,
}: {
  supplierId: string;
  supplierItems: SupplierItemRow[];
  inventoryItems: InventoryItemOption[];
  canManageItems: boolean;
  canReadPrice: boolean;
  canManagePrice: boolean;
}) {
  return (
    <div className="space-y-4">
      {canManageItems && (
        <div className="flex justify-end">
          <LinkItemDialog supplierId={supplierId} inventoryItems={inventoryItems} />
        </div>
      )}
      {supplierItems.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No items linked yet.{" "}
          {canManageItems
            ? "Link an inventory item to start recording prices."
            : "Ask an admin to link items."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Supplier SKU</TableHead>
                <TableHead>Pack size</TableHead>
                {canReadPrice && <TableHead>Current price</TableHead>}
                {canManagePrice && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplierItems.map((si) => (
                <TableRow key={si.id}>
                  <TableCell className="font-medium">{si.itemName}</TableCell>
                  <TableCell className="font-data text-muted-foreground text-xs">
                    {si.itemSku}
                  </TableCell>
                  <TableCell className="font-data text-muted-foreground text-xs">
                    {si.supplierSku ?? "—"}
                  </TableCell>
                  <TableCell className="font-data text-xs">{si.packSize ?? "—"}</TableCell>
                  {canReadPrice && (
                    <TableCell>
                      <PriceCell latestPrice={si.latestPrice} />
                    </TableCell>
                  )}
                  {canManagePrice && (
                    <TableCell className="text-right">
                      <AddPriceDialog supplierId={supplierId} supplierItem={si} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
