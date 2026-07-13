"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import {
  submitReceiptAction,
  type ReceiveActionState,
} from "@/app/(app)/purchasing/receiving/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface ReceivingPoDetail {
  id: string;
  reference: string;
  supplierName: string;
  status: string;
}

export interface ReceivingLineRow {
  id: string;
  itemName: string;
  itemSku: string;
  unitCode: string;
  orderedQty: number;
  receivedAcceptedQty: number;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <PackageCheck className="size-4" /> {pending ? "Posting receipt…" : "Post receipt"}
    </Button>
  );
}

function ReceivingLine({ line }: { line: ReceivingLineRow }) {
  const outstanding = Math.max(0, line.orderedQty - line.receivedAcceptedQty);
  const fullyReceived = outstanding <= 0;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{line.itemName}</p>
          <p className="text-muted-foreground font-data text-xs">
            {line.itemSku} · unit {line.unitCode}
          </p>
        </div>
        {fullyReceived ? (
          <Badge variant="secondary">Fully received</Badge>
        ) : (
          <Badge variant="outline">Outstanding: {outstanding}</Badge>
        )}
      </div>

      {!fullyReceived && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor={`accepted_${line.id}`} className="text-xs">
              Accepted
            </Label>
            <Input
              id={`accepted_${line.id}`}
              name={`accepted_${line.id}`}
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              defaultValue="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`rejected_${line.id}`} className="text-xs">
              Rejected
            </Label>
            <Input
              id={`rejected_${line.id}`}
              name={`rejected_${line.id}`}
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              defaultValue="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`damaged_${line.id}`} className="text-xs">
              Damaged
            </Label>
            <Input
              id={`damaged_${line.id}`}
              name={`damaged_${line.id}`}
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              defaultValue="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`missing_${line.id}`} className="text-xs">
              Missing
            </Label>
            <Input
              id={`missing_${line.id}`}
              name={`missing_${line.id}`}
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              defaultValue="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`lot_${line.id}`} className="text-xs">
              Lot number
            </Label>
            <Input id={`lot_${line.id}`} name={`lot_${line.id}`} type="text" maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`expiry_${line.id}`} className="text-xs">
              Expiry date
            </Label>
            <Input id={`expiry_${line.id}`} name={`expiry_${line.id}`} type="date" />
          </div>
        </div>
      )}
    </div>
  );
}

export function ReceivingClient({
  po,
  lines,
  canReceive,
  loadError = false,
}: {
  po: ReceivingPoDetail;
  lines: ReceivingLineRow[];
  canReceive: boolean;
  loadError?: boolean;
}) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, formAction] = useActionState<ReceiveActionState, FormData>(
    submitReceiptAction.bind(null, po.id),
    {},
  );

  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      router.push("/purchasing/receiving");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  if (loadError) {
    return (
      <div className="text-destructive rounded-lg border border-dashed p-10 text-center">
        Could not load this order&apos;s lines. Try refreshing the page.
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
        This purchase order has no lines to receive.
      </div>
    );
  }

  if (!canReceive) {
    return (
      <Alert>
        <AlertDescription>
          {po.reference} is {po.status.replace(/_/g, " ")} and isn&apos;t open for receiving.
          Purchase orders must be approved before a delivery can be recorded against them.
        </AlertDescription>
      </Alert>
    );
  }

  const allFullyReceived = lines.every((l) => l.orderedQty - l.receivedAcceptedQty <= 0);

  if (allFullyReceived) {
    return (
      <Alert>
        <AlertDescription>
          Every line on {po.reference} has already been fully received.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-3">
        {lines.map((line) => (
          <ReceivingLine key={line.id} line={line} />
        ))}
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
