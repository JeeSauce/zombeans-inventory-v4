"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  LockKeyhole,
  RefreshCcw,
  Scale,
} from "lucide-react";
import {
  closeDayAction,
  openRecountAction,
  postVarianceAdjustmentAction,
  reopenDayAction,
  submitRecountAction,
  type DailyOpsActionState,
} from "@/app/(app)/daily-ops/actions";
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
import { normalizeRecountQty } from "@/lib/recounts/calculations";

export interface DailyOpsBranch {
  id: string;
  name: string;
  isMain: boolean;
}

export interface DailyOpsItem {
  id: string;
  name: string;
  sku: string;
  unitCode: string;
}

export interface RecountLineView {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  unitCode: string;
  expectedQty: number;
  physicalQty: number | null;
  varianceQty: number | null;
  unusualSignals: string[];
}

export interface RecountSessionView {
  id: string;
  reference: string;
  branchId: string;
  branchName: string;
  type: "start_of_day" | "end_of_day" | "cycle";
  status: "draft" | "submitted" | "adjusted" | "closed";
  isUnusual: boolean;
  unusualSignals: string[];
  openedAt: string;
  submittedAt: string | null;
  adjustmentReference: string | null;
  adjustmentReason: string | null;
  lines: RecountLineView[];
}

export interface DayCloseEventView {
  id: string;
  reference: string;
  type: "close" | "reopen";
  reason: string | null;
  createdAt: string;
  laterChanges: Array<{
    reference: string;
    type: string;
    reason: string | null;
    createdAt: string;
  }>;
}

export interface DayClosureView {
  id: string;
  reference: string;
  branchId: string;
  status: "closed" | "reopened";
  lastClosedAt: string;
  lastReopenedAt: string | null;
  events: DayCloseEventView[];
}

function SubmitButton({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Saving…" : children}
    </Button>
  );
}

function ActionFeedback({ state }: { state: DailyOpsActionState }) {
  if (state.error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.info) {
    return (
      <p className="text-sm text-green-700 dark:text-green-300" role="status">
        {state.info}
      </p>
    );
  }
  return null;
}

function useStableActionToken(state: DailyOpsActionState) {
  const [token, setToken] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (state.info) setToken(crypto.randomUUID());
  }, [state.info]);
  return token;
}

function OpenRecountForm({
  type,
  title,
  description,
  branches,
  items,
  businessDate,
}: {
  type: "start_of_day" | "end_of_day" | "cycle";
  title: string;
  description: string;
  branches: DailyOpsBranch[];
  items: DailyOpsItem[];
  businessDate: string;
}) {
  const [state, formAction] = useActionState<DailyOpsActionState, FormData>(openRecountAction, {});
  const token = useStableActionToken(state);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {type === "start_of_day" ? (
            <CalendarCheck className="size-5 text-green-600" />
          ) : type === "cycle" ? (
            <RefreshCcw className="size-5 text-amber-600" />
          ) : (
            <ClipboardCheck className="size-5 text-sky-600" />
          )}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="businessDate" value={businessDate} />
          <input type="hidden" name="idempotencyKey" value={token} />
          <div className="space-y-2">
            <Label htmlFor={`${type}-branch`}>Branch</Label>
            <select
              id={`${type}-branch`}
              name="branchId"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              required
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
          {type === "cycle" && (
            <div className="space-y-2">
              <Label htmlFor="cycle-item">Item to count</Label>
              <select
                id="cycle-item"
                name="itemIds"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select inventory item
                </option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.sku} ({item.unitCode})
                  </option>
                ))}
              </select>
            </div>
          )}
          <ActionFeedback state={state} />
          <SubmitButton>Open {title.toLowerCase()}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

function DraftRecountForm({ session }: { session: RecountSessionView }) {
  const [state, formAction] = useActionState<DailyOpsActionState, FormData>(
    submitRecountAction,
    {},
  );
  const token = useStableActionToken(state);
  const [physical, setPhysical] = useState<Record<string, string>>(() =>
    Object.fromEntries(session.lines.map((line) => [line.id, String(line.expectedQty)])),
  );
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="sessionId" value={session.id} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="min-w-40">Physical</TableHead>
              <TableHead className="text-right">Live variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {session.lines.map((line) => {
              const value = Number(physical[line.id] ?? line.expectedQty);
              const variance = Number.isFinite(value)
                ? normalizeRecountQty(value - line.expectedQty)
                : 0;
              return (
                <TableRow key={line.id}>
                  <TableCell>
                    <span className="font-medium">{line.itemName}</span>
                    <span className="text-muted-foreground font-data block text-xs">
                      {line.itemSku} · {line.unitCode}
                    </span>
                  </TableCell>
                  <TableCell className="font-data text-right">{line.expectedQty}</TableCell>
                  <TableCell>
                    <Label className="sr-only" htmlFor={`physical-${line.id}`}>
                      Physical quantity for {line.itemName}
                    </Label>
                    <Input
                      id={`physical-${line.id}`}
                      name={`physical_${line.id}`}
                      type="number"
                      min="0"
                      step="0.0001"
                      required
                      value={physical[line.id] ?? ""}
                      onChange={(event) =>
                        setPhysical((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell
                    className={`font-data text-right font-semibold ${
                      variance === 0
                        ? "text-green-700 dark:text-green-300"
                        : "text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {variance > 0 ? "+" : ""}
                    {variance}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Alert>
        <Scale className="size-4" />
        <AlertTitle>Counts use base units</AlertTitle>
        <AlertDescription>
          Submit all rows together. If stock moved after this snapshot, the stale count is rejected
          instead of posting an unsafe correction.
        </AlertDescription>
      </Alert>
      <ActionFeedback state={state} />
      <SubmitButton>Submit physical counts</SubmitButton>
    </form>
  );
}

const REASON_OPTIONS = [
  ["counting_error", "Counting error"],
  ["unrecorded_movement", "Unrecorded movement"],
  ["spoilage", "Spoilage"],
  ["damage", "Damage"],
  ["theft_or_loss", "Theft or loss"],
  ["found_stock", "Found stock"],
  ["unit_conversion", "Unit conversion"],
  ["other", "Other"],
] as const;

function AdjustmentForm({
  session,
  canConfirmUnusual,
}: {
  session: RecountSessionView;
  canConfirmUnusual: boolean;
}) {
  const [state, formAction] = useActionState<DailyOpsActionState, FormData>(
    postVarianceAdjustmentAction,
    {},
  );
  const token = useStableActionToken(state);
  if (session.isUnusual && !canConfirmUnusual) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Super Admin review required</AlertTitle>
        <AlertDescription>
          This variance triggered unusual-policy signals. Its frozen counts remain submitted until
          Super Admin posts the compensating entry.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <form action={formAction} className="space-y-4 rounded-lg border p-4">
      <input type="hidden" name="sessionId" value={session.id} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`reason-type-${session.id}`}>Adjustment reason type</Label>
          <select
            id={`reason-type-${session.id}`}
            name="reasonType"
            required
            defaultValue=""
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="" disabled>
              Select reason
            </option>
            {REASON_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`reason-${session.id}`}>Verified explanation</Label>
          <textarea
            id={`reason-${session.id}`}
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>
      <ActionFeedback state={state} />
      <SubmitButton>
        {session.isUnusual ? "Post Super Admin adjustment" : "Post compensating adjustment"}
      </SubmitButton>
    </form>
  );
}

function RecountSessionCard({
  session,
  canConfirmUnusual,
}: {
  session: RecountSessionView;
  canConfirmUnusual: boolean;
}) {
  const typeLabel = session.type
    .split("_")
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(" ");
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{typeLabel}</CardTitle>
            <CardDescription>
              {session.reference} · {session.branchName} · opened {session.openedAt}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={session.status === "submitted" ? "destructive" : "secondary"}>
              {session.status.replace("_", " ")}
            </Badge>
            {session.isUnusual && <Badge variant="destructive">Unusual review</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {session.status === "draft" ? (
          <DraftRecountForm session={session} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Physical</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {session.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <span className="font-medium">{line.itemName}</span>
                      <span className="text-muted-foreground font-data block text-xs">
                        {line.itemSku} · {line.unitCode}
                      </span>
                    </TableCell>
                    <TableCell className="font-data text-right">{line.expectedQty}</TableCell>
                    <TableCell className="font-data text-right">
                      {line.physicalQty ?? "—"}
                    </TableCell>
                    <TableCell className="font-data text-right font-semibold">
                      {(line.varianceQty ?? 0) > 0 ? "+" : ""}
                      {line.varianceQty ?? "—"}
                    </TableCell>
                    <TableCell>
                      {line.unusualSignals.length > 0 ? (
                        <span className="text-amber-700 dark:text-amber-300">Escalated signal</span>
                      ) : (
                        <span className="text-muted-foreground">Ordinary</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {session.status === "submitted" && (
          <AdjustmentForm session={session} canConfirmUnusual={canConfirmUnusual} />
        )}
        {(session.status === "adjusted" || session.status === "closed") && (
          <Alert>
            <CheckCircle2 className="size-4 text-green-600" />
            <AlertTitle>Recount complete</AlertTitle>
            <AlertDescription>
              {session.adjustmentReference
                ? `${session.adjustmentReference} posted. ${session.adjustmentReason ?? ""}`
                : "Physical stock matched the frozen expected snapshot."}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function CloseForm({ branch, businessDate }: { branch: DailyOpsBranch; businessDate: string }) {
  const [state, formAction] = useActionState<DailyOpsActionState, FormData>(closeDayAction, {});
  const token = useStableActionToken(state);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="branchId" value={branch.id} />
      <input type="hidden" name="businessDate" value={businessDate} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <ActionFeedback state={state} />
      <SubmitButton>Close {branch.name}</SubmitButton>
    </form>
  );
}

function ReopenForm({ branch, businessDate }: { branch: DailyOpsBranch; businessDate: string }) {
  const [state, formAction] = useActionState<DailyOpsActionState, FormData>(reopenDayAction, {});
  const token = useStableActionToken(state);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.info) formRef.current?.reset();
  }, [state.info]);
  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-lg border p-4">
      <input type="hidden" name="branchId" value={branch.id} />
      <input type="hidden" name="businessDate" value={businessDate} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <div className="space-y-2">
        <Label htmlFor={`reopen-${branch.id}`}>Required reopen reason</Label>
        <textarea
          id={`reopen-${branch.id}`}
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <ActionFeedback state={state} />
      <SubmitButton>Reopen business day</SubmitButton>
    </form>
  );
}

function BranchCloseCard({
  branch,
  sessions,
  closure,
  businessDate,
  canClose,
  canReopen,
}: {
  branch: DailyOpsBranch;
  sessions: RecountSessionView[];
  closure: DayClosureView | undefined;
  businessDate: string;
  canClose: boolean;
  canReopen: boolean;
}) {
  const startComplete = sessions.some(
    (session) =>
      session.type === "start_of_day" &&
      (session.status === "adjusted" || session.status === "closed"),
  );
  const blockers = sessions.filter(
    (session) => session.status === "draft" || session.status === "submitted",
  );
  const ready = startComplete && blockers.length === 0;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{branch.name}</CardTitle>
            <CardDescription>
              {closure?.reference ?? "Not closed for this business date"}
            </CardDescription>
          </div>
          <Badge variant={closure?.status === "closed" ? "destructive" : "secondary"}>
            {closure?.status ?? "open"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <span className="text-muted-foreground block text-xs">Start-of-day</span>
            <span
              className={startComplete ? "text-green-700 dark:text-green-300" : "text-amber-700"}
            >
              {startComplete ? "Complete" : "Required before close"}
            </span>
          </div>
          <div className="rounded-md border p-3">
            <span className="text-muted-foreground block text-xs">Open recount blockers</span>
            <span>{blockers.length === 0 ? "None" : `${blockers.length} unresolved`}</span>
          </div>
        </div>

        {closure?.status === "closed" ? (
          <Alert variant="destructive">
            <LockKeyhole className="size-4" />
            <AlertTitle>Day closed</AlertTitle>
            <AlertDescription>
              Ordinary inventory postings are blocked. A Super Admin must reopen with a reason.
            </AlertDescription>
          </Alert>
        ) : ready ? (
          <Alert>
            <CheckCircle2 className="size-4 text-green-600" />
            <AlertTitle>Ready to close</AlertTitle>
            <AlertDescription>
              Required recounts are complete and no variance remains unresolved.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTriangle className="size-4 text-amber-600" />
            <AlertTitle>Close blocked</AlertTitle>
            <AlertDescription>
              Complete the start-of-day recount and resolve every submitted variance or draft count.
            </AlertDescription>
          </Alert>
        )}

        {canClose && closure?.status !== "closed" && ready && (
          <CloseForm branch={branch} businessDate={businessDate} />
        )}
        {canReopen && closure?.status === "closed" && (
          <ReopenForm branch={branch} businessDate={businessDate} />
        )}

        {closure && closure.events.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <h4 className="font-semibold">Close and reopen audit trail</h4>
            {closure.events.map((event) => (
              <div key={event.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {event.type === "reopen" ? "Reopened" : "Closed"} · {event.reference}
                  </span>
                  <span className="text-muted-foreground">{event.createdAt}</span>
                </div>
                {event.reason && <p className="mt-1">Reason: {event.reason}</p>}
                {event.laterChanges.length > 0 && (
                  <div className="mt-3 space-y-1 border-l-2 pl-3">
                    <p className="text-muted-foreground text-xs font-semibold uppercase">
                      Later attributed changes
                    </p>
                    {event.laterChanges.map((change) => (
                      <p key={change.reference}>
                        {change.reference} · {change.type.replaceAll("_", " ")} · {change.createdAt}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DailyOpsClient({
  branches,
  items,
  sessions,
  closures,
  businessDate,
  businessDateLabel,
  canPerform,
  canClose,
  canConfirmUnusual,
  canReopen,
  loadError,
}: {
  branches: DailyOpsBranch[];
  items: DailyOpsItem[];
  sessions: RecountSessionView[];
  closures: DayClosureView[];
  businessDate: string;
  businessDateLabel: string;
  canPerform: boolean;
  canClose: boolean;
  canConfirmUnusual: boolean;
  canReopen: boolean;
  loadError: boolean;
}) {
  const closureByBranch = useMemo(
    () => new Map(closures.map((closure) => [closure.branchId, closure])),
    [closures],
  );
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Phase 7 · Daily control</p>
        <h1 className="text-3xl font-semibold tracking-tight">Daily operations</h1>
        <p className="text-muted-foreground mt-1">
          Recounts, compensating corrections, and branch day close for {businessDateLabel}.
        </p>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Daily Ops data could not be loaded</AlertTitle>
          <AlertDescription>
            Refresh before counting. Posting controls remain unavailable when required data is
            incomplete.
          </AlertDescription>
        </Alert>
      )}

      {!loadError && canPerform && (
        <section className="grid gap-4 lg:grid-cols-3" aria-label="Open a recount">
          <OpenRecountForm
            type="start_of_day"
            title="Start-of-day recount"
            description="Required full count before this business date can close."
            branches={branches}
            items={items}
            businessDate={businessDate}
          />
          <OpenRecountForm
            type="cycle"
            title="Cycle count"
            description="Target one item for an operational spot check."
            branches={branches}
            items={items}
            businessDate={businessDate}
          />
          <OpenRecountForm
            type="end_of_day"
            title="End-of-day recount"
            description="Optional full count; once opened, it must resolve before close."
            branches={branches}
            items={items}
            businessDate={businessDate}
          />
        </section>
      )}

      <section className="space-y-4" aria-labelledby="recount-sessions-heading">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-5" />
          <h2 id="recount-sessions-heading" className="text-xl font-semibold">
            Today&apos;s recounts
          </h2>
          <Badge variant="secondary">{sessions.length}</Badge>
        </div>
        {sessions.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              No recount is open yet. Start-of-day remains required before close.
            </CardContent>
          </Card>
        ) : (
          sessions.map((session) => (
            <RecountSessionCard
              key={session.id}
              session={session}
              canConfirmUnusual={canConfirmUnusual}
            />
          ))
        )}
      </section>

      <section className="space-y-4" aria-labelledby="day-close-heading">
        <div className="flex items-center gap-2">
          <LockKeyhole className="size-5" />
          <h2 id="day-close-heading" className="text-xl font-semibold">
            Day close and reopen
          </h2>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {branches.map((branch) => (
            <BranchCloseCard
              key={branch.id}
              branch={branch}
              sessions={sessions.filter((session) => session.branchId === branch.id)}
              closure={closureByBranch.get(branch.id)}
              businessDate={businessDate}
              canClose={canClose}
              canReopen={canReopen}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
