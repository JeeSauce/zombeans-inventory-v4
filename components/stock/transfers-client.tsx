"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Truck } from "lucide-react";
import { toast } from "sonner";
import { prepareTransferAction, type StockActionState } from "@/app/(app)/stock/actions";
import type { StockBranchOption, StockItemOption } from "@/components/stock/stock-overview-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface TransferRow {
  id: string;
  reference: string;
  sourceBranchName: string;
  destBranchName: string;
  status: string;
  createdAt: string;
  lineSummary: string;
}

export interface ApprovedRequestOption {
  id: string;
  reference: string;
  branchName: string;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Truck className="size-4" />
      {pending ? "Preparing…" : "Prepare transfer"}
    </Button>
  );
}

function PrepareTransferForm({
  branches,
  items,
  requests,
  selectedRequestId,
}: {
  branches: StockBranchOption[];
  items: StockItemOption[];
  requests: ApprovedRequestOption[];
  selectedRequestId?: string;
}) {
  const [state, action] = useActionState<StockActionState, FormData>(prepareTransferAction, {});
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [requestId, setRequestId] = useState(selectedRequestId ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) {
      toast.success(state.info);
      formRef.current?.reset();
      setRequestId("");
      setToken(crypto.randomUUID());
    }
  }, [state]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prepare transfer</CardTitle>
        <CardDescription>
          Preparation records intent only. Manager approval performs the FEFO source dispatch.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="space-y-4">
          <input type="hidden" name="idempotencyKey" value={token} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="transfer-source">Source branch</Label>
              <select
                id="transfer-source"
                name="sourceBranchId"
                required
                defaultValue=""
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="" disabled>
                  Select source
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
              <Label htmlFor="transfer-dest">Destination branch</Label>
              <select
                id="transfer-dest"
                name="destBranchId"
                required
                defaultValue=""
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="" disabled>
                  Select destination
                </option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.isMain ? " (Main)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="transfer-request">Approved request (optional)</Label>
              <select
                id="transfer-request"
                name="stockRequestId"
                value={requestId}
                onChange={(event) => setRequestId(event.target.value)}
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="">Standalone transfer</option>
                {requests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {request.reference} · {request.branchName}
                  </option>
                ))}
              </select>
            </div>
            {!requestId && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="transfer-item">Item</Label>
                  <select
                    id="transfer-item"
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
                  <Label htmlFor="transfer-qty">Prepared quantity</Label>
                  <Input
                    id="transfer-qty"
                    name="qty"
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    required
                  />
                </div>
              </>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="transfer-notes">Notes</Label>
              <Input id="transfer-notes" name="notes" maxLength={1000} />
            </div>
          </div>
          {state.error && (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          )}
          {state.info && <p className="text-sm text-green-700 dark:text-green-300">{state.info}</p>}
          <Submit />
        </form>
      </CardContent>
    </Card>
  );
}

export function TransfersClient({
  transfers,
  branches,
  items,
  requests,
  canPrepare,
  selectedRequestId,
  loadError,
}: {
  transfers: TransferRow[];
  branches: StockBranchOption[];
  items: StockItemOption[];
  requests: ApprovedRequestOption[];
  canPrepare: boolean;
  selectedRequestId?: string;
  loadError: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Multi-branch stock</p>
          <h1 className="text-3xl font-semibold tracking-tight">Transfers</h1>
          <p className="text-muted-foreground mt-1">
            Prepare → manager dispatch → idempotent receiving.
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
          <AlertTitle>Transfers could not be loaded</AlertTitle>
          <AlertDescription>Refresh before taking a lifecycle action.</AlertDescription>
        </Alert>
      )}
      {!loadError && canPrepare && (
        <PrepareTransferForm
          branches={branches}
          items={items}
          requests={requests}
          selectedRequestId={selectedRequestId}
        />
      )}
      <section className="space-y-3" aria-labelledby="transfer-history">
        <h2 id="transfer-history" className="text-xl font-semibold">
          Transfer history
        </h2>
        {transfers.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              No transfers prepared yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {transfers.map((transfer) => (
              <Card key={transfer.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{transfer.reference}</CardTitle>
                      <CardDescription>{transfer.createdAt}</CardDescription>
                    </div>
                    <Badge
                      variant={
                        transfer.status === "cancelled"
                          ? "destructive"
                          : transfer.status === "received"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {transfer.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{transfer.sourceBranchName}</span>
                    <ArrowRight className="text-muted-foreground size-4" />
                    <span className="font-medium">{transfer.destBranchName}</span>
                  </div>
                  <p className="text-muted-foreground text-sm">{transfer.lineSummary}</p>
                  <Button asChild size="sm">
                    <Link href={`/stock/transfers/${transfer.id}`}>Open transfer</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
