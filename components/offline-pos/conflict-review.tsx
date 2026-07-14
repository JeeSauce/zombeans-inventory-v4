"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, Scale } from "lucide-react";
import {
  resolveOfflineConflictAction,
  type Phase10ActionState,
} from "@/app/(app)/offline-pos/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export type OfflineConflictView = {
  id: string;
  reference: string;
  submissionType: "recount" | "production";
  branchName: string;
  businessDate: string | null;
  snapshotAt: string;
  submittedAt: string;
  submittedByName: string;
  conflictReason: string;
  productionOrderReference: string | null;
  details: Record<string, unknown>;
  items: Array<{
    name: string;
    sku: string;
    physicalQty: number | null;
    unitCode: string;
  }>;
};

function ConflictDecision({ conflict }: { conflict: OfflineConflictView }) {
  const [state, action, pending] = useActionState<Phase10ActionState, FormData>(
    resolveOfflineConflictAction,
    {},
  );
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"accept" | "reject">("reject");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-data font-semibold">{conflict.reference}</p>
          <p className="text-muted-foreground text-sm">
            {conflict.branchName} · submitted by {conflict.submittedByName}
          </p>
        </div>
        <Badge variant="outline">{conflict.submissionType}</Badge>
      </div>
      <Alert>
        <AlertTriangle className="size-4 text-amber-600" />
        <AlertTitle>Server held this submission</AlertTitle>
        <AlertDescription>{conflict.conflictReason}</AlertDescription>
      </Alert>
      {conflict.productionOrderReference && (
        <p className="text-sm">Production order: {conflict.productionOrderReference}</p>
      )}
      {conflict.items.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {conflict.items.map((item) => (
            <div key={`${item.sku}-${item.name}`} className="bg-muted/40 rounded-md p-3 text-sm">
              <p className="font-medium">{item.name}</p>
              <p className="text-muted-foreground">{item.sku}</p>
              {item.physicalQty !== null && (
                <p className="font-data mt-1">
                  Counted {item.physicalQty} {item.unitCode}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      {state.info && <p className="text-sm text-green-700 dark:text-green-300">{state.info}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Scale className="size-4" />
            Review decision
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve {conflict.reference}</DialogTitle>
            <DialogDescription>
              Accept asks the server to revalidate and apply the draft. Reject preserves evidence
              and posts nothing. Neither choice edits prior ledger rows.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="submissionId" value={conflict.id} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <div className="space-y-2">
              <Label htmlFor={`decision-${conflict.id}`}>Decision</Label>
              <select
                id={`decision-${conflict.id}`}
                name="decision"
                value={decision}
                onChange={(event) => setDecision(event.target.value as "accept" | "reject")}
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="reject">Reject — post nothing</option>
                <option value="accept">Accept — server revalidates and applies</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`reason-${conflict.id}`}>Review reason</Label>
              <textarea
                id={`reason-${conflict.id}`}
                name="reason"
                className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
                minLength={3}
                maxLength={1000}
                required
                placeholder="Explain the evidence checked and the decision."
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                variant={decision === "reject" ? "destructive" : "default"}
                disabled={pending}
              >
                {pending ? "Applying server decision…" : `Confirm ${decision}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ConflictReview({ conflicts }: { conflicts: OfflineConflictView[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Scale className="size-5 text-amber-600" />
          <CardTitle>Conflict review</CardTitle>
          <Badge variant={conflicts.length > 0 ? "destructive" : "secondary"}>
            {conflicts.length}
          </Badge>
        </div>
        <CardDescription>
          Conflicts never auto-win. An authorized person must inspect and record a reason.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {conflicts.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
            No offline submissions require review.
          </div>
        ) : (
          conflicts.map((conflict) => <ConflictDecision key={conflict.id} conflict={conflict} />)
        )}
      </CardContent>
    </Card>
  );
}
