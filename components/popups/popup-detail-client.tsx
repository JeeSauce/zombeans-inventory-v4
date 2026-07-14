"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  CheckCircle2,
  Info,
  Link2,
  PackageCheck,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelPopupEventAction,
  completePopupEventAction,
  linkPopupStockMovementAction,
  linkPopupTransferAction,
  recordPopupCountAction,
  startPopupEventAction,
  type PopupActionState,
} from "@/app/(app)/popups/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatHumanDateTime } from "@/lib/format";
import { POPUP_STOCK_MOVEMENT_TYPES } from "@/lib/validation/phase8";

export interface PopupDetail {
  id: string;
  reference: string;
  status: "planned" | "in_progress" | "reconciling" | "completed" | "cancelled";
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  popupBranchId: string;
  popupBranchName: string;
  returnBranchId: string;
  returnBranchName: string;
  notes: string | null;
  startedAt: string | null;
  countedAt: string | null;
  completedAt: string | null;
}
export interface PopupCountRow {
  itemId: string;
  unitId: string;
  itemName: string;
  itemSku: string;
  unitCode: string;
  transferredInQty: number;
  remainingQty: number;
  returnedQty: number;
  consumedQty: number;
  wasteQty: number;
  lossQty: number;
  gainQty: number;
  endingQty: number;
  notes: string | null;
}
export interface PopupMovementRow {
  id: string;
  movementType: string;
  quantity: number;
  itemName: string;
  itemSku: string;
  sourceReference: string;
}
type Item = { id: string; name: string; sku: string; unitId: string; unitCode: string };
type Transfer = {
  id: string;
  reference: string;
  status: string;
  sourceName: string;
  destinationName: string;
};
type StockMovement = { id: string; reference: string; type: string; reason: string | null };

function usePopupAction(
  action: (state: PopupActionState, formData: FormData) => Promise<PopupActionState>,
) {
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [state, formAction] = useActionState<PopupActionState, FormData>(action, {});
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) {
      toast.success(state.info);
      setToken(crypto.randomUUID());
    }
  }, [state.error, state.info]);
  return { token, formAction };
}

function CommandForm({
  detail,
  command,
  label,
  icon,
  variant = "default",
}: {
  detail: PopupDetail;
  command: "start" | "complete";
  label: string;
  icon: React.ReactNode;
  variant?: "default" | "outline";
}) {
  const { token, formAction } = usePopupAction(
    command === "start" ? startPopupEventAction : completePopupEventAction,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="popupEventId" value={detail.id} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <Button type="submit" variant={variant}>
        {icon}
        {label}
      </Button>
    </form>
  );
}

function CancelForm({ detail }: { detail: PopupDetail }) {
  const { token, formAction } = usePopupAction(cancelPopupEventAction);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="popupEventId" value={detail.id} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <div className="space-y-1">
        <Label htmlFor="cancel-reason">Cancellation reason</Label>
        <Input id="cancel-reason" name="reason" minLength={3} required />
      </div>
      <Button type="submit" variant="destructive">
        <XCircle />
        Cancel engagement
      </Button>
    </form>
  );
}

function TransferLinkForm({ detail, transfers }: { detail: PopupDetail; transfers: Transfer[] }) {
  const { token, formAction } = usePopupAction(linkPopupTransferAction);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="popupEventId" value={detail.id} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <label className="min-w-64 flex-1 space-y-1 text-sm">
        <span>Existing Main ↔ Popup transfer</span>
        <select
          className="border-input bg-background h-9 w-full rounded-md border px-3"
          name="transferId"
          required
        >
          <option value="">Choose transfer</option>
          {transfers.map((transfer) => (
            <option key={transfer.id} value={transfer.id}>
              {transfer.reference} · {transfer.sourceName} → {transfer.destinationName} ·{" "}
              {transfer.status}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="outline" disabled={!transfers.length}>
        <Link2 />
        Link transfer
      </Button>
    </form>
  );
}

function StockLinkForm({ detail, movements }: { detail: PopupDetail; movements: StockMovement[] }) {
  const { token, formAction } = usePopupAction(linkPopupStockMovementAction);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
      <input type="hidden" name="popupEventId" value={detail.id} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <label className="space-y-1 text-sm">
        <span>Posted Popup ledger movement</span>
        <select
          className="border-input bg-background h-9 w-full rounded-md border px-3"
          name="stockTxnId"
          required
        >
          <option value="">Choose posted movement</option>
          {movements.map((movement) => (
            <option key={movement.id} value={movement.id}>
              {movement.reference} · {movement.type.replaceAll("_", " ")} ·{" "}
              {movement.reason ?? "No note"}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span>Summary category</span>
        <select
          className="border-input bg-background h-9 w-full rounded-md border px-3"
          name="movementType"
        >
          {POPUP_STOCK_MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="outline" disabled={!movements.length}>
        <Link2 />
        Link movement
      </Button>
    </form>
  );
}

type EditableRow = Omit<PopupCountRow, "itemName" | "itemSku" | "unitCode">;
const emptyRow = (item?: Item): EditableRow => ({
  itemId: item?.id ?? "",
  unitId: item?.unitId ?? "",
  transferredInQty: 0,
  remainingQty: 0,
  returnedQty: 0,
  consumedQty: 0,
  wasteQty: 0,
  lossQty: 0,
  gainQty: 0,
  endingQty: 0,
  notes: null,
});

function CountForm({
  detail,
  countRows,
  items,
}: {
  detail: PopupDetail;
  countRows: PopupCountRow[];
  items: Item[];
}) {
  const { token, formAction } = usePopupAction(recordPopupCountAction);
  const [rows, setRows] = useState<EditableRow[]>(() =>
    countRows.length
      ? countRows.map(({ itemName: _name, itemSku: _sku, unitCode: _unit, ...row }) => row)
      : items.length
        ? [emptyRow(items[0])]
        : [],
  );
  const update = (index: number, patch: Partial<EditableRow>) =>
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  const numberFields: Array<[keyof EditableRow, string]> = [
    ["transferredInQty", "Transferred in"],
    ["remainingQty", "Remaining count"],
    ["returnedQty", "Returned"],
    ["consumedQty", "Consumed"],
    ["wasteQty", "Waste"],
    ["lossQty", "Loss"],
    ["gainQty", "Gain"],
    ["endingQty", "Ending at Popup"],
  ];
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="popupEventId" value={detail.id} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      {rows.map((row, index) => {
        const selected = items.find((item) => item.id === row.itemId);
        return (
          <Card key={`${row.itemId}-${index}`}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Count line {index + 1}</CardTitle>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Remove count line"
                onClick={() =>
                  setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
                }
              >
                <Trash2 />
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>Item</span>
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-3"
                  value={row.itemId}
                  onChange={(event) => {
                    const item = items.find((option) => option.id === event.target.value);
                    update(index, { itemId: event.target.value, unitId: item?.unitId ?? "" });
                  }}
                >
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.sku} · {item.unitCode}
                    </option>
                  ))}
                </select>
              </label>
              {numberFields.map(([field, label]) => (
                <label key={field} className="space-y-1 text-sm">
                  <span>
                    {label} ({selected?.unitCode ?? "unit"})
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={String(row[field] ?? 0)}
                    onChange={(event) => update(index, { [field]: Number(event.target.value) })}
                  />
                </label>
              ))}
              <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-4">
                <span>Notes</span>
                <Input
                  value={row.notes ?? ""}
                  onChange={(event) => update(index, { notes: event.target.value || null })}
                />
              </label>
            </CardContent>
          </Card>
        );
      })}
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows((current) => [
              ...current,
              emptyRow(
                items.find((item) => !current.some((row) => row.itemId === item.id)) ?? items[0],
              ),
            ])
          }
          disabled={!items.length || rows.length >= items.length}
        >
          <Plus />
          Add item
        </Button>
        <Button type="submit" disabled={!rows.length}>
          <PackageCheck />
          Save reconciled count
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Transferred + gain must equal consumed + waste + loss + remaining. Remaining must equal
        returned + ending.
      </p>
    </form>
  );
}

export function PopupDetailClient({
  detail,
  countRows,
  movements,
  transfers,
  stockMovements,
  items,
  canManage,
  loadError,
}: {
  detail: PopupDetail;
  countRows: PopupCountRow[];
  movements: PopupMovementRow[];
  transfers: Transfer[];
  stockMovements: StockMovement[];
  items: Item[];
  canManage: boolean;
  loadError: boolean;
}) {
  const active = !["completed", "cancelled"].includes(detail.status);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Popup engagement · {detail.reference}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl">{detail.title}</h1>
          <Badge
            variant={
              detail.status === "cancelled"
                ? "destructive"
                : detail.status === "completed"
                  ? "secondary"
                  : "outline"
            }
          >
            {detail.status.replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1">
          {detail.location ?? "Location pending"} · {formatHumanDateTime(detail.startsAt)} –{" "}
          {formatHumanDateTime(detail.endsAt)}
        </p>
      </div>
      {loadError && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>Some popup details could not load</AlertTitle>
          <AlertDescription>
            Do not complete until transfers, movements, and count lines are visible.
          </AlertDescription>
        </Alert>
      )}
      {detail.status === "completed" && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Event inventory summary completed</AlertTitle>
          <AlertDescription>
            All nonzero quantities are backed by received transfers or posted ledger movements.
            Completion did not mutate inventory.
          </AlertDescription>
        </Alert>
      )}
      {detail.status === "reconciling" && (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>Reconciliation in progress</AlertTitle>
          <AlertDescription>
            Return every remaining unit to {detail.returnBranchName}, link posted
            consumed/waste/loss/gain movements, then complete.
          </AlertDescription>
        </Alert>
      )}
      {!canManage && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Read-only summary</AlertTitle>
          <AlertDescription>
            Only Super Admin and Branch Manager can manage this engagement.
          </AlertDescription>
        </Alert>
      )}
      {canManage && active && (
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {detail.status === "planned" && (
                <CommandForm
                  detail={detail}
                  command="start"
                  label="Start engagement"
                  icon={<Play />}
                />
              )}
              {detail.status === "reconciling" && (
                <CommandForm
                  detail={detail}
                  command="complete"
                  label="Complete summary"
                  icon={<CheckCircle2 />}
                />
              )}
            </div>
            <CancelForm detail={detail} />
          </CardContent>
        </Card>
      )}
      {canManage && ["planned", "in_progress", "reconciling"].includes(detail.status) && (
        <Card>
          <CardHeader>
            <CardTitle>Ledger-backed movements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Alert>
              <Info className="size-4" />
              <AlertDescription>
                Post or receive inventory first in{" "}
                <Link href="/stock" className="underline">
                  Stock
                </Link>
                , then link that human reference here. This screen never writes stock.
              </AlertDescription>
            </Alert>
            <TransferLinkForm detail={detail} transfers={transfers} />
            {detail.status !== "planned" && (
              <StockLinkForm detail={detail} movements={stockMovements} />
            )}
          </CardContent>
        </Card>
      )}
      {canManage && ["in_progress", "reconciling"].includes(detail.status) && (
        <Card>
          <CardHeader>
            <CardTitle>Remaining count and event summary</CardTitle>
          </CardHeader>
          <CardContent>
            <CountForm detail={detail} countRows={countRows} items={items} />
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Frozen inventory summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {countRows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No event count has been recorded.</p>
            ) : (
              countRows.map((row) => (
                <div key={row.itemId} className="rounded-lg border p-3">
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.itemName}</p>
                      <p className="font-data text-muted-foreground text-xs">{row.itemSku}</p>
                    </div>
                    <span className="font-data">
                      {row.transferredInQty} {row.unitCode} in
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-2 grid grid-cols-3 gap-2 text-xs">
                    <span>{row.consumedQty} consumed</span>
                    <span>{row.wasteQty} waste</span>
                    <span>{row.lossQty} loss</span>
                    <span>{row.gainQty} gain</span>
                    <span>{row.returnedQty} returned</span>
                    <span>{row.endingQty} ending</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Linked posted movements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {movements.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No received transfer or ledger movement is linked yet.
              </p>
            ) : (
              movements.map((movement) => (
                <div
                  key={movement.id}
                  className="flex justify-between gap-3 border-b pb-2 last:border-0"
                >
                  <div>
                    <p className="font-medium">{movement.itemName}</p>
                    <p className="font-data text-muted-foreground text-xs">
                      {movement.itemSku} · {movement.sourceReference}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline">{movement.movementType.replaceAll("_", " ")}</Badge>
                    <p className="font-data mt-1 text-sm">{movement.quantity}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
