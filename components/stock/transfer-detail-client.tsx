"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, PackageCheck, Send } from "lucide-react";
import { toast } from "sonner";
import {
  approveTransferAction,
  receiveTransferAction,
  resolveTransferDiscrepancyAction,
  type StockActionState,
} from "@/app/(app)/stock/actions";
import { accountedReceivingQty } from "@/lib/stock/quantities";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface TransferDetailLine {
  id: string;
  itemName: string;
  itemSku: string;
  unitCode: string;
  preparedQty: number;
  shippedQty: number;
  receivedQty: number;
  rejectedQty: number;
  damagedQty: number;
  missingQty: number;
}

export interface TransferDiscrepancyRow {
  id: string;
  itemName: string;
  type: string;
  qty: number;
  reason: string;
  status: string;
  resolution: string | null;
}

export interface TransferDetail {
  id: string;
  reference: string;
  status: string;
  sourceBranchName: string;
  destBranchName: string;
  notes: string | null;
  preparedAt: string;
  approvedAt: string | null;
  receivedAt: string | null;
  lines: TransferDetailLine[];
  discrepancies: TransferDiscrepancyRow[];
}

function FormSubmit({ label, icon }: { label: string; icon?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {icon}
      {pending ? "Saving…" : label}
    </Button>
  );
}

function ReceiveForm({ transfer }: { transfer: TransferDetail }) {
  const bound = receiveTransferAction.bind(null, transfer.id);
  const [state, action] = useActionState<StockActionState, FormData>(bound, {});
  const [token] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) toast.success(state.info);
  }, [state]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Receive transfer</CardTitle>
        <CardDescription>
          Every shipped unit must be counted as received, rejected, damaged, or missing. This form
          keeps one stable replay token.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="idempotencyKey" value={token} />
          {transfer.lines.map((line) => (
            <div key={line.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">{line.itemName}</p>
                  <p className="text-muted-foreground font-data text-xs">{line.itemSku}</p>
                </div>
                <Badge variant="outline">
                  Shipped {line.shippedQty} {line.unitCode}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ["received", "Received", line.shippedQty],
                    ["rejected", "Rejected", 0],
                    ["damaged", "Damaged", 0],
                    ["missing", "Missing", 0],
                  ] as const
                ).map(([key, label, value]) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={`${key}-${line.id}`} className="text-xs">
                      {label}
                    </Label>
                    <Input
                      id={`${key}-${line.id}`}
                      name={`${key}_${line.id}`}
                      type="number"
                      min="0"
                      step="0.0001"
                      defaultValue={value}
                      required
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-2">
            <Label htmlFor="discrepancy-reason">
              Discrepancy reason (required if any unit is not received)
            </Label>
            <Input id="discrepancy-reason" name="discrepancyReason" maxLength={1000} />
          </div>
          {state.error && (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          )}
          {state.info && <p className="text-sm text-green-700 dark:text-green-300">{state.info}</p>}
          <FormSubmit label="Confirm receipt" icon={<PackageCheck className="size-4" />} />
        </form>
      </CardContent>
    </Card>
  );
}

function ResolutionForm({ discrepancy }: { discrepancy: TransferDiscrepancyRow }) {
  const bound = resolveTransferDiscrepancyAction.bind(null, discrepancy.id);
  const [state, action] = useActionState<StockActionState, FormData>(bound, {});
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) toast.success(state.info);
  }, [state]);
  return (
    <form action={action} className="mt-3 flex flex-col gap-2 sm:flex-row">
      <Label htmlFor={`resolution-${discrepancy.id}`} className="sr-only">
        Resolution
      </Label>
      <Input
        id={`resolution-${discrepancy.id}`}
        name="resolution"
        placeholder="Document investigation and resolution"
        minLength={3}
        maxLength={1000}
        required
      />
      <FormSubmit label="Resolve" icon={<CheckCircle2 className="size-4" />} />
      {state.error && (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function TransferDetailClient({
  transfer,
  canApprove,
  canReceive,
}: {
  transfer: TransferDetail;
  canApprove: boolean;
  canReceive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function approve() {
    startTransition(async () => {
      const result = await approveTransferAction(transfer.id);
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.info);
        router.refresh();
      }
    });
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Transfer</p>
          <h1 className="text-3xl font-semibold tracking-tight">{transfer.reference}</h1>
          <p className="text-muted-foreground mt-1">
            {transfer.sourceBranchName} → {transfer.destBranchName}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge
            variant={
              transfer.status === "received"
                ? "secondary"
                : transfer.status === "cancelled"
                  ? "destructive"
                  : "outline"
            }
          >
            {transfer.status.replaceAll("_", " ")}
          </Badge>
          <Button asChild variant="outline">
            <Link href="/stock/transfers">
              <ArrowLeft className="size-4" />
              Transfers
            </Link>
          </Button>
        </div>
      </div>
      <Alert>
        <AlertTitle>Server-guarded lifecycle</AlertTitle>
        <AlertDescription>
          Source stock leaves only at manager approval. Destination stock posts only through
          idempotent receiving.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Transfer lines</CardTitle>
          <CardDescription>
            Prepared {transfer.preparedAt}
            {transfer.approvedAt ? ` · dispatched ${transfer.approvedAt}` : ""}
            {transfer.receivedAt ? ` · received ${transfer.receivedAt}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {transfer.lines.map((line) => {
            const accounted = accountedReceivingQty({
              shipped: line.shippedQty,
              received: line.receivedQty,
              rejected: line.rejectedQty,
              damaged: line.damagedQty,
              missing: line.missingQty,
            });
            return (
              <div key={line.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-medium">{line.itemName}</p>
                    <p className="text-muted-foreground font-data text-xs">{line.itemSku}</p>
                  </div>
                  <p className="font-data text-sm">
                    Prepared {line.preparedQty} {line.unitCode}
                  </p>
                </div>
                {transfer.status !== "prepared" && (
                  <p className="text-muted-foreground mt-2 text-sm">
                    Shipped {line.shippedQty} · accounted {accounted} {line.unitCode}
                    {transfer.status === "received"
                      ? ` (received ${line.receivedQty}, rejected ${line.rejectedQty}, damaged ${line.damagedQty}, missing ${line.missingQty})`
                      : ""}
                  </p>
                )}
              </div>
            );
          })}
          {transfer.notes && <p className="text-muted-foreground text-sm">{transfer.notes}</p>}
          {canApprove && transfer.status === "prepared" && (
            <Button onClick={approve} disabled={pending}>
              <Send className="size-4" />
              {pending ? "Dispatching…" : "Approve and dispatch"}
            </Button>
          )}
        </CardContent>
      </Card>
      {canReceive && transfer.status === "in_transit" && <ReceiveForm transfer={transfer} />}
      {transfer.status === "in_transit" && !canReceive && (
        <Alert>
          <AlertTitle>Awaiting destination count</AlertTitle>
          <AlertDescription>
            An Inventory Staff receiver must confirm every shipped quantity.
          </AlertDescription>
        </Alert>
      )}
      <section className="space-y-3" aria-labelledby="discrepancies-heading">
        <div className="flex items-center gap-2">
          <h2 id="discrepancies-heading" className="text-xl font-semibold">
            Receiving discrepancies
          </h2>
          {transfer.discrepancies.some((item) => item.status === "open") && (
            <Badge variant="destructive">Open</Badge>
          )}
        </div>
        {transfer.discrepancies.length === 0 ? (
          <Alert>
            <AlertTitle>No discrepancies recorded</AlertTitle>
            <AlertDescription>
              {transfer.status === "received"
                ? "The destination count matched the accepted shipment."
                : "Discrepancies appear after receiving."}
            </AlertDescription>
          </Alert>
        ) : (
          transfer.discrepancies.map((discrepancy) => (
            <Card key={discrepancy.id}>
              <CardContent className="pt-0">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-5 text-amber-600" />
                  <div className="flex-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-medium">
                        {discrepancy.itemName} · {discrepancy.type}
                      </p>
                      <Badge variant={discrepancy.status === "open" ? "destructive" : "secondary"}>
                        {discrepancy.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {discrepancy.qty} · {discrepancy.reason}
                    </p>
                    {discrepancy.resolution && (
                      <p className="mt-2 text-sm">Resolution: {discrepancy.resolution}</p>
                    )}
                    {canApprove && discrepancy.status === "open" && (
                      <ResolutionForm discrepancy={discrepancy} />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
