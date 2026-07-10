"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createItemAction, type ItemActionState } from "@/app/(app)/catalog/items/actions";
import { ITEM_TYPES } from "@/lib/validation/catalog";
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

export interface OptionRow {
  id: string;
  label: string;
}
export interface ItemRow {
  id: string;
  name: string;
  sku: string;
  itemType: (typeof ITEM_TYPES)[number];
  active: boolean;
  categoryName: string | null;
  baseUnit: string;
}

const TYPE_LABELS: Record<string, string> = {
  drink: "Drink",
  food: "Food",
  raw_ingredient: "Raw ingredient",
  sub_product: "Sub-product",
  portioned_product: "Portioned product",
  packaging: "Packaging",
  container: "Container",
};

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create item"}
    </Button>
  );
}

function CreateItemDialog({
  categories,
  units,
}: {
  categories: (OptionRow & { itemType: string })[];
  units: OptionRow[];
}) {
  const [open, setOpen] = useState(false);
  const [itemType, setItemType] = useState<string>("raw_ingredient");
  const [state, formAction] = useActionState<ItemActionState, FormData>(createItemAction, {});

  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state]);

  const scopedCategories = useMemo(
    () => categories.filter((c) => c.itemType === itemType),
    [categories, itemType],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> Add item
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New inventory item</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="itemType">Type</Label>
              <select
                id="itemType"
                name="itemType"
                className={selectClass}
                value={itemType}
                onChange={(e) => setItemType(e.target.value)}
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="categoryId">Category</Label>
              <select id="categoryId" name="categoryId" className={selectClass} defaultValue="">
                <option value="">— none —</option>
                {scopedCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="baseUnitId">Base unit</Label>
              <select
                id="baseUnitId"
                name="baseUnitId"
                className={selectClass}
                required
                defaultValue=""
              >
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
              <Label htmlFor="purchaseUnitId">Purchase unit (optional)</Label>
              <select
                id="purchaseUnitId"
                name="purchaseUnitId"
                className={selectClass}
                defaultValue=""
              >
                <option value="">— same as base —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lowStockThreshold">Low-stock threshold</Label>
              <Input
                id="lowStockThreshold"
                name="lowStockThreshold"
                type="number"
                step="0.0001"
                min="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reorderLevel">Reorder level</Label>
              <Input id="reorderLevel" name="reorderLevel" type="number" step="0.0001" min="0" />
            </div>
          </div>
          <fieldset className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="trackable" defaultChecked className="accent-primary" />
              Tracked in stock
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="isConsumable"
                defaultChecked
                className="accent-primary"
              />
              Consumable
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="batchTracked" className="accent-primary" />
              Batch tracked
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="expiryTracked" className="accent-primary" />
              Expiry tracked
            </label>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="storageNotes">Storage notes (optional)</Label>
            <Input id="storageNotes" name="storageNotes" />
          </div>
          <div className="flex justify-end">
            <Submit />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ItemsClient({
  items,
  categories,
  units,
  canWrite,
}: {
  items: ItemRow[];
  categories: (OptionRow & { itemType: string })[];
  units: OptionRow[];
  canWrite: boolean;
}) {
  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <CreateItemDialog categories={categories} units={units} />
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No items yet.{" "}
          {canWrite ? "Add your first item to build the catalog." : "Ask an admin to add items."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Base unit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-data text-muted-foreground text-xs">
                    {it.sku}
                  </TableCell>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{TYPE_LABELS[it.itemType] ?? it.itemType}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{it.categoryName ?? "—"}</TableCell>
                  <TableCell className="font-data text-xs">{it.baseUnit}</TableCell>
                  <TableCell>
                    <Badge variant={it.active ? "default" : "secondary"}>
                      {it.active ? "active" : "inactive"}
                    </Badge>
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
