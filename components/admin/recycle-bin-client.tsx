"use client";

import { useActionState, useEffect, useState } from "react";
import { ArchiveRestore, ShieldAlert, Trash2 } from "lucide-react";
import {
  purgeRecycleBinAction,
  restoreRecycleRecordAction,
  softDeleteRecordAction,
  type RecycleActionState,
} from "@/app/(app)/admin/recycle-bin/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatHumanDateTime } from "@/lib/format";
import type { RecycleBinEntry, RecycleEntityType } from "@/lib/validation/phase9";

export interface RecycleCandidate {
  entityType: RecycleEntityType;
  entityId: string;
  label: string;
}

const INITIAL_STATE: RecycleActionState = {};

function useIdempotencyKey(success?: string) {
  const [key, setKey] = useState("");
  useEffect(() => setKey(crypto.randomUUID()), [success]);
  return key;
}

function ActionMessage({ state }: { state: RecycleActionState }) {
  if (!state.error && !state.info) return null;
  return (
    <p
      className={state.error ? "text-destructive text-sm" : "text-success text-sm"}
      aria-live="polite"
    >
      {state.error ?? state.info}
    </p>
  );
}

function RestoreForm({ entry }: { entry: RecycleBinEntry }) {
  const [state, action, pending] = useActionState(restoreRecycleRecordAction, INITIAL_STATE);
  const idempotencyKey = useIdempotencyKey(state.info);
  return (
    <form
      action={action}
      className="space-y-2"
      onSubmit={(event) => {
        if (!window.confirm(`Restore ${entry.label}?`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="entityType" value={entry.entity_type} />
      <input type="hidden" name="entityId" value={entry.entity_id} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Label htmlFor={`restore-${entry.entity_id}`}>Restore reason</Label>
      <Input
        id={`restore-${entry.entity_id}`}
        name="reason"
        required
        minLength={3}
        maxLength={1000}
        placeholder="Why is this record returning?"
      />
      <Button type="submit" size="sm" disabled={pending || !idempotencyKey}>
        <ArchiveRestore aria-hidden="true" /> {pending ? "Restoring…" : "Restore"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function RecycleBinClient({
  entries,
  candidates,
}: {
  entries: RecycleBinEntry[];
  candidates: RecycleCandidate[];
}) {
  const [deleteState, deleteAction, deleting] = useActionState(
    softDeleteRecordAction,
    INITIAL_STATE,
  );
  const [purgeState, purgeAction, purging] = useActionState(purgeRecycleBinAction, INITIAL_STATE);
  const deleteKey = useIdempotencyKey(deleteState.info);
  const purgeKey = useIdempotencyKey(purgeState.info);

  return (
    <div className="space-y-6">
      <Alert className="border-amber-500/40 bg-amber-500/5">
        <ShieldAlert aria-hidden="true" />
        <AlertTitle>Retention is dependency-aware</AlertTitle>
        <AlertDescription>
          Records remain recoverable for 30 days. Ledger, audit-hold, legal, accounting, and
          structural dependencies prevent permanent purge; audit history is never deleted.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Move a record to the recycle bin</CardTitle>
            <CardDescription>
              Business values remain unchanged and normal reads hide the record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {candidates.length ? (
              <form
                action={deleteAction}
                className="space-y-4"
                onSubmit={(event) => {
                  if (!window.confirm("Move this record to the recycle bin for 30 days?"))
                    event.preventDefault();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="record">Record</Label>
                  <select
                    id="record"
                    name="record"
                    required
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="">Select by name or reference</option>
                    {candidates.map((candidate) => (
                      <option
                        key={`${candidate.entityType}:${candidate.entityId}`}
                        value={`${candidate.entityType}|${candidate.entityId}`}
                      >
                        {candidate.entityType.replaceAll("_", " ")} — {candidate.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delete-reason">Deletion reason</Label>
                  <Input
                    id="delete-reason"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={1000}
                    placeholder="Why should this record be hidden?"
                  />
                </div>
                <input type="hidden" name="idempotencyKey" value={deleteKey} />
                <Button type="submit" variant="destructive" disabled={deleting || !deleteKey}>
                  <Trash2 aria-hidden="true" /> {deleting ? "Moving…" : "Move to recycle bin"}
                </Button>
                <ActionMessage state={deleteState} />
              </form>
            ) : (
              <p className="text-muted-foreground text-sm">
                No eligible active root records are available.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run eligible purge</CardTitle>
            <CardDescription>
              Only expired, dependency-free records are permanently removed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={purgeAction}
              className="space-y-4"
              onSubmit={(event) => {
                if (!window.confirm("Permanently purge all eligible expired records?"))
                  event.preventDefault();
              }}
            >
              <input type="hidden" name="runKey" value={purgeKey} />
              <input type="hidden" name="limit" value="100" />
              <Button type="submit" variant="outline" disabled={purging || !purgeKey}>
                <ShieldAlert aria-hidden="true" />{" "}
                {purging ? "Checking dependencies…" : "Purge eligible records"}
              </Button>
              <ActionMessage state={purgeState} />
            </form>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="font-heading text-xl font-semibold">Deleted records</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Names and human references are shown; internal IDs stay hidden.
        </p>
      </div>

      {entries.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {entries.map((entry) => (
            <Card key={`${entry.entity_type}:${entry.entity_id}`}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle>{entry.label}</CardTitle>
                  <Badge variant={entry.eligible_for_purge ? "destructive" : "secondary"}>
                    {entry.eligible_for_purge ? "Purge eligible" : "Protected"}
                  </Badge>
                </div>
                <CardDescription className="capitalize">
                  {entry.entity_type.replaceAll("_", " ")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Deleted</dt>
                    <dd>{formatHumanDateTime(entry.deleted_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Deleted by</dt>
                    <dd>{entry.deleted_by_name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Purge deadline</dt>
                    <dd>{formatHumanDateTime(entry.purge_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Retention status</dt>
                    <dd>{entry.dependency_reason ?? "Eligible now"}</dd>
                  </div>
                </dl>
                <RestoreForm entry={entry} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center">
            The recycle bin is empty.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
