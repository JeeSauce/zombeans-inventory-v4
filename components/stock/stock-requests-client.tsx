"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Check, ClipboardList, X } from "lucide-react";
import { toast } from "sonner";
import {
  createStockRequestAction,
  reviewStockRequestAction,
  type StockActionState,
} from "@/app/(app)/stock/actions";
import type { StockBranchOption, StockItemOption } from "@/components/stock/stock-overview-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface StockRequestLineRow {
  id: string;
  itemName: string;
  itemSku: string;
  unitCode: string;
  requestedQty: number;
  approvedQty: number;
}

export interface StockRequestRow {
  id: string;
  reference: string;
  branchName: string;
  status: string;
  notes: string | null;
  createdAt: string;
  lines: StockRequestLineRow[];
}

function PendingButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} disabled={pending || props.disabled}>
      {pending ? "Saving…" : children}
    </Button>
  );
}

function CreateRequestForm({
  branches,
  items,
}: {
  branches: StockBranchOption[];
  items: StockItemOption[];
}) {
  const [state, action] = useActionState<StockActionState, FormData>(createStockRequestAction, {});
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
        <CardTitle>New stock request</CardTitle>
        <CardDescription>
          Request branch-held prepared items or packaging for Main review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="space-y-4">
          <input type="hidden" name="idempotencyKey" value={token} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="request-branch">Requesting branch</Label>
              <select
                id="request-branch"
                name="requestingBranchId"
                required
                defaultValue=""
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
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
              <Label htmlFor="request-item">Item</Label>
              <select
                id="request-item"
                name="itemId"
                required
                defaultValue=""
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
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
              <Label htmlFor="request-qty">Requested quantity</Label>
              <Input
                id="request-qty"
                name="qty"
                type="number"
                min="0.0001"
                step="0.0001"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="request-notes">Notes</Label>
              <Input id="request-notes" name="notes" maxLength={1000} />
            </div>
          </div>
          {state.error && (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          )}
          {state.info && <p className="text-sm text-green-700 dark:text-green-300">{state.info}</p>}
          <PendingButton type="submit">
            <ClipboardList className="size-4" />
            Create request
          </PendingButton>
        </form>
      </CardContent>
    </Card>
  );
}

function ReviewRequestForm({ request }: { request: StockRequestRow }) {
  const bound = reviewStockRequestAction.bind(null, request.id);
  const [state, action] = useActionState<StockActionState, FormData>(bound, {});
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) toast.success(state.info);
  }, [state]);
  return (
    <form action={action} className="mt-4 space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Manager review</p>
      {request.lines.map((line) => (
        <div key={line.id} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem]">
          <div>
            <p className="text-sm">{line.itemName}</p>
            <p className="text-muted-foreground font-data text-xs">
              Requested {line.requestedQty} {line.unitCode}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`approved-${line.id}`} className="text-xs">
              Approved
            </Label>
            <Input
              id={`approved-${line.id}`}
              name={`approved_${line.id}`}
              type="number"
              min="0"
              max={line.requestedQty}
              step="0.0001"
              defaultValue={line.requestedQty}
            />
          </div>
        </div>
      ))}
      <div className="space-y-1">
        <Label htmlFor={`review-notes-${request.id}`}>Review notes</Label>
        <Input id={`review-notes-${request.id}`} name="reviewNotes" maxLength={1000} />
      </div>
      {state.error && (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <PendingButton type="submit" name="decision" value="approve">
          <Check className="size-4" />
          Approve
        </PendingButton>
        <PendingButton type="submit" name="decision" value="reject" variant="outline">
          <X className="size-4" />
          Reject
        </PendingButton>
      </div>
    </form>
  );
}

export function StockRequestsClient({
  requests,
  branches,
  items,
  canPrepare,
  canApprove,
  loadError,
}: {
  requests: StockRequestRow[];
  branches: StockBranchOption[];
  items: StockItemOption[];
  canPrepare: boolean;
  canApprove: boolean;
  loadError: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Multi-branch stock</p>
          <h1 className="text-3xl font-semibold tracking-tight">Stock requests</h1>
          <p className="text-muted-foreground mt-1">
            Branch request → Main review → transfer preparation.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/stock">
            <ArrowLeft className="size-4" />
            Stock overview
          </Link>
        </Button>
      </div>
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Requests could not be loaded</AlertTitle>
          <AlertDescription>Refresh before reviewing or preparing stock.</AlertDescription>
        </Alert>
      )}
      {!loadError && canPrepare && <CreateRequestForm branches={branches} items={items} />}
      <section className="space-y-3" aria-labelledby="request-history">
        <h2 id="request-history" className="text-xl font-semibold">
          Request history
        </h2>
        {requests.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              No stock requests yet.
            </CardContent>
          </Card>
        ) : (
          requests.map((request) => (
            <Card key={request.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{request.reference}</CardTitle>
                    <CardDescription>
                      {request.branchName} · {request.createdAt}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      request.status === "rejected" || request.status === "cancelled"
                        ? "destructive"
                        : request.status === "fulfilled"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {request.status.replaceAll("_", " ")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {request.lines.map((line) => (
                  <div
                    key={line.id}
                    className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <span className="font-medium">{line.itemName}</span>
                      <span className="text-muted-foreground font-data block text-xs">
                        {line.itemSku}
                      </span>
                    </div>
                    <div className="font-data text-right">
                      Requested {line.requestedQty} {line.unitCode}
                      {request.status !== "requested" && (
                        <span className="text-muted-foreground block text-xs">
                          Approved {line.approvedQty}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {request.notes && <p className="text-muted-foreground text-sm">{request.notes}</p>}
                {canApprove && request.status === "requested" && (
                  <ReviewRequestForm request={request} />
                )}
                {canPrepare && request.status === "approved" && (
                  <Button asChild size="sm">
                    <Link href={`/stock/transfers?request=${request.id}`}>Prepare transfer</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
