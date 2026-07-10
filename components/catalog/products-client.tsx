"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus, Tags, Lock } from "lucide-react";
import {
  createProductAction,
  setBranchPricesAction,
  type ProductActionState,
} from "@/app/(app)/catalog/products/actions";
import { computeLineTax, type TaxConfig } from "@/lib/catalog/tax";
import { formatPeso } from "@/lib/format";
import { TAX_MODES, type TaxMode } from "@/lib/validation/catalog";
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

export interface BranchOption {
  id: string;
  name: string;
  isMain: boolean;
}
export interface UnitOption {
  id: string;
  label: string;
}
export interface BranchPrice {
  branchId: string;
  price: number;
  taxMode: TaxMode;
}
export interface ProductRow {
  id: string;
  name: string;
  sku: string;
  kind: "drink" | "food";
  isActive: boolean;
  prices: BranchPrice[];
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

const TAX_LABELS: Record<TaxMode, string> = {
  none: "No tax",
  exclusive: "Add on top",
  inclusive: "Price includes",
};

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function CreateProductDialog({ units }: { units: UnitOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ProductActionState, FormData>(createProductAction, {});

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
          <Plus className="size-4" /> Add product
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="name">Product name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="productKind">Kind</Label>
              <select
                id="productKind"
                name="productKind"
                className={selectClass}
                defaultValue="drink"
              >
                <option value="drink">Drink</option>
                <option value="food">Food</option>
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input id="description" name="description" />
          </div>
          <div className="flex justify-end">
            <Submit label="Create product" busy="Creating…" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PricesDialog({ product, branches }: { product: ProductRow; branches: BranchOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ProductActionState, FormData>(
    setBranchPricesAction.bind(null, product.id),
    {},
  );

  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state]);

  const priceFor = (branchId: string) => product.prices.find((p) => p.branchId === branchId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Tags className="size-3.5" /> Prices
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prices — {product.name}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <p className="text-muted-foreground text-xs">
            Each branch has its own price. Leave a price blank to remove it for that branch.
          </p>
          {branches.map((b) => {
            const existing = priceFor(b.id);
            return (
              <div
                key={b.id}
                className="grid grid-cols-[1fr_auto] items-end gap-3 rounded-md border p-3"
              >
                <div className="space-y-1">
                  <Label htmlFor={`price_${b.id}`} className="flex items-center gap-1.5">
                    {b.name}
                    {b.isMain && <Badge variant="secondary">Commissary</Badge>}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id={`price_${b.id}`}
                      name={`price_${b.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="—"
                      defaultValue={existing ? existing.price : ""}
                      className="font-data w-32"
                    />
                    <select
                      name={`tax_${b.id}`}
                      className={`${selectClass} w-40`}
                      defaultValue={existing?.taxMode ?? "none"}
                    >
                      {TAX_MODES.map((m) => (
                        <option key={m} value={m}>
                          {TAX_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex justify-end">
            <Submit label="Save prices" busy="Saving…" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceCell({ price, vat }: { price: BranchPrice | undefined; vat: TaxConfig }) {
  if (!price) return <span className="text-muted-foreground">—</span>;
  const t = computeLineTax(price.price, price.taxMode, vat);
  return (
    <span className="font-data">
      {formatPeso(t.gross)}
      {t.applied && <span className="text-muted-foreground ml-1 text-[0.65rem]">incl. VAT</span>}
    </span>
  );
}

export function ProductsClient({
  products,
  branches,
  units,
  vat,
  canWrite,
  canReadPrice,
  canWritePrice,
}: {
  products: ProductRow[];
  branches: BranchOption[];
  units: UnitOption[];
  vat: TaxConfig;
  canWrite: boolean;
  canReadPrice: boolean;
  canWritePrice: boolean;
}) {
  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <CreateProductDialog units={units} />
        </div>
      )}
      {products.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No products yet.{" "}
          {canWrite
            ? "Add a drink or food product to start pricing it."
            : "Ask an admin to add products."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                {canReadPrice ? (
                  branches.map((b) => (
                    <TableHead key={b.id} className="text-right">
                      {b.name}
                    </TableHead>
                  ))
                ) : (
                  <TableHead className="text-right">
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Lock className="size-3" /> Prices hidden
                    </span>
                  </TableHead>
                )}
                <TableHead className="text-right">Status</TableHead>
                {canWritePrice && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-data text-muted-foreground text-xs">{p.sku}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.kind}</Badge>
                  </TableCell>
                  {canReadPrice ? (
                    branches.map((b) => (
                      <TableCell key={b.id} className="text-right">
                        <PriceCell price={p.prices.find((x) => x.branchId === b.id)} vat={vat} />
                      </TableCell>
                    ))
                  ) : (
                    <TableCell className="text-muted-foreground text-right">—</TableCell>
                  )}
                  <TableCell className="text-right">
                    <Badge variant={p.isActive ? "default" : "secondary"}>
                      {p.isActive ? "active" : "inactive"}
                    </Badge>
                  </TableCell>
                  {canWritePrice && (
                    <TableCell className="text-right">
                      <PricesDialog product={p} branches={branches} />
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
