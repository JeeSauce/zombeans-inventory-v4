"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import {
  postStockInAction,
  postStockOutAction,
  type StockActionState,
} from "@/app/(app)/stock/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export interface StockBranchOption {
  id: string;
  name: string;
  isMain: boolean;
}

export interface StockItemOption {
  id: string;
  name: string;
  sku: string;
  unitCode: string;
  batchTracked: boolean;
  expiryTracked: boolean;
}

export interface StockBalanceRow {
  itemName: string;
  itemSku: string;
  branchName: string;
  unitCode: string;
  qtyOnHand: number;
}

export interface StockAlertRow {
  id: string;
  itemName: string;
  itemSku: string;
  branchName: string;
  qtyOnHand: number;
  reason: string;
  createdAt: string;
}

function SubmitButton({ mode }: { mode: "in" | "out" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {mode === "in" ? (
        <ArrowDownToLine className="size-4" />
      ) : (
        <ArrowUpFromLine className="size-4" />
      )}
      {pending ? "Posting…" : mode === "in" ? "Post stock-in" : "Post stock-out"}
    </Button>
  );
}

function StockMovementForm({
  mode,
  branches,
  items,
}: {
  mode: "in" | "out";
  branches: StockBranchOption[];
  items: StockItemOption[];
}) {
  const action = mode === "in" ? postStockInAction : postStockOutAction;
  const [state, formAction] = useActionState<StockActionState, FormData>(action, {});
  const [token, setToken] = useState(() => crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) {
      toast.success(state.info);
      formRef.current?.reset();
      setToken(crypto.randomUUID());
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "in" ? "Direct stock-in" : "Direct stock-out"}</CardTitle>
        <CardDescription>
          {mode === "in"
            ? "Add a verified quantity with batch and expiry details when tracked."
            : "Record the full operational removal. Negative balances stay visible and raise Critical alerts."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <input type="hidden" name="idempotencyKey" value={token} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${mode}-branch`}>Branch</Label>
              <select
                id={`${mode}-branch`}
                name="branchId"
                required
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Select branch
                </option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.isMain ? " (Main)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${mode}-item`}>Inventory item</Label>
              <select
                id={`${mode}-item`}
                name="itemId"
                required
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Select item
                </option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.sku} ({item.unitCode})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${mode}-qty`}>Quantity (base unit)</Label>
              <Input
                id={`${mode}-qty`}
                name="qty"
                type="number"
                step="0.0001"
                min="0.0001"
                required
              />
            </div>
            {mode === "in" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="stock-in-lot">Batch / lot number</Label>
                  <Input id="stock-in-lot" name="lotNumber" maxLength={80} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stock-in-expiry">Expiration date</Label>
                  <Input id="stock-in-expiry" name="expirationDate" type="date" />
                </div>
              </>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${mode}-reason`}>
                {mode === "in" ? "Source / reason" : "Operational cause"}
              </Label>
              <Input id={`${mode}-reason`} name="reason" required minLength={3} maxLength={240} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${mode}-notes`}>Notes (optional)</Label>
              <Input id={`${mode}-notes`} name="notes" maxLength={1000} />
            </div>
          </div>
          {state.error && (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          )}
          {state.info && <p className="text-sm text-green-700 dark:text-green-300">{state.info}</p>}
          <SubmitButton mode={mode} />
        </form>
      </CardContent>
    </Card>
  );
}

export function StockOverviewClient({
  branches,
  items,
  balances,
  alerts,
  canStockIn,
  canStockOut,
  canPrepare,
  canApprove,
  canReceive,
  loadError,
}: {
  branches: StockBranchOption[];
  items: StockItemOption[];
  balances: StockBalanceRow[];
  alerts: StockAlertRow[];
  canStockIn: boolean;
  canStockOut: boolean;
  canPrepare: boolean;
  canApprove: boolean;
  canReceive: boolean;
  loadError: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Phase 6 · Multi-branch</p>
          <h1 className="text-3xl font-semibold tracking-tight">Stock operations</h1>
          <p className="text-muted-foreground mt-1">
            Append-only movements, branch balances, and Critical exceptions.
          </p>
        </div>
        <div className="flex gap-2">
          {(canPrepare || canApprove) && (
            <Button asChild variant="outline">
              <Link href="/stock/requests">
                <ClipboardList className="size-4" />
                Requests
              </Link>
            </Button>
          )}
          {(canPrepare || canApprove || canReceive) && (
            <Button asChild variant="outline">
              <Link href="/stock/transfers">
                <Truck className="size-4" />
                Transfers
              </Link>
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Stock data could not be loaded</AlertTitle>
          <AlertDescription>
            Refresh the page. Posting controls remain unavailable until reference data loads safely.
          </AlertDescription>
        </Alert>
      )}

      {alerts.length > 0 ? (
        <section className="space-y-3" aria-labelledby="critical-alerts-heading">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-red-600" />
            <h2 id="critical-alerts-heading" className="text-xl font-semibold">
              Critical negative inventory
            </h2>
            <Badge variant="destructive">{alerts.length} active</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {alerts.map((alert) => (
              <Alert key={alert.id} variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertTitle>
                  {alert.itemName} · {alert.branchName}
                </AlertTitle>
                <AlertDescription>
                  <span className="font-data font-semibold">{alert.qtyOnHand}</span> on hand ·{" "}
                  {alert.reason}
                  <span className="mt-1 block text-xs">
                    SKU {alert.itemSku} · {alert.createdAt}
                  </span>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        </section>
      ) : (
        <Alert>
          <AlertTitle>No active Critical stock alerts</AlertTitle>
          <AlertDescription>All visible branch balances are zero or above.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Branch balances</CardTitle>
          <CardDescription>Negative quantities are never clamped or hidden.</CardDescription>
        </CardHeader>
        <CardContent>
          {balances.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No stock balances have been posted yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((row) => (
                    <TableRow
                      key={`${row.itemSku}-${row.branchName}`}
                      className={row.qtyOnHand < 0 ? "bg-red-50 dark:bg-red-950/20" : undefined}
                    >
                      <TableCell>
                        <span className="font-medium">{row.itemName}</span>
                        <span className="text-muted-foreground font-data block text-xs">
                          {row.itemSku}
                        </span>
                      </TableCell>
                      <TableCell>{row.branchName}</TableCell>
                      <TableCell
                        className={`font-data text-right font-semibold ${row.qtyOnHand < 0 ? "text-red-700 dark:text-red-300" : ""}`}
                      >
                        {row.qtyOnHand} {row.unitCode}
                      </TableCell>
                      <TableCell>
                        {row.qtyOnHand < 0 ? (
                          <Badge variant="destructive">Critical</Badge>
                        ) : (
                          <Badge variant="secondary">Visible</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {!loadError && (canStockIn || canStockOut) && (
        <div className="grid gap-6 xl:grid-cols-2">
          {canStockIn && <StockMovementForm mode="in" branches={branches} items={items} />}
          {canStockOut && <StockMovementForm mode="out" branches={branches} items={items} />}
        </div>
      )}
    </div>
  );
}
