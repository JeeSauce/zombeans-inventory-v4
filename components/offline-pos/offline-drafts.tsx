"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Cloud, CloudOff, Factory, FilePenLine, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  issueOfflineSnapshotAction,
  syncOfflineDraftAction,
} from "@/app/(app)/offline-pos/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyDraftEvent,
  createDraftIdentity,
  listDrafts,
  removeDraft,
  saveDraft,
  transitionDraft,
} from "@/lib/offline/draft-store";
import type { OfflineDraft } from "@/lib/validation/phase10";

export type OfflineBranchOption = { id: string; name: string };
export type OfflineItemOption = {
  id: string;
  name: string;
  sku: string;
  unitCode: string;
};
export type OfflineProductionOrderOption = {
  id: string;
  reference: string;
  branchId: string;
  branchName: string;
  outputName: string;
  outputSku: string;
  unitCode: string;
  plannedOutputQty: number;
  inputs: Array<{
    id: string;
    itemName: string;
    itemSku: string;
    unitCode: string;
    plannedQty: number;
  }>;
};

function stateBadge(state: OfflineDraft["state"]) {
  if (state === "error" || state === "review_required") return "destructive" as const;
  if (state === "synced") return "default" as const;
  return "secondary" as const;
}

function DraftEditor({
  draft,
  onSaved,
}: {
  draft: OfflineDraft;
  onSaved: (draft: OfflineDraft) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);

  async function saveEdits(formData: FormData) {
    try {
      let edited: OfflineDraft;
      if (draft.type === "recount") {
        edited = {
          ...draft,
          payload: {
            ...draft.payload,
            reason: String(formData.get("reason") ?? ""),
            lines: draft.payload.lines.map((line) => ({
              ...line,
              physicalQty: Number(formData.get(`physical-${line.itemId}`)),
            })),
          },
        };
      } else {
        edited = {
          ...draft,
          payload: {
            ...draft.payload,
            actualOutputQty: Number(formData.get("actualOutputQty")),
            outputLotNumber: String(formData.get("outputLotNumber") ?? ""),
            productionDate: String(formData.get("productionDate") ?? ""),
            expirationDate: String(formData.get("expirationDate") ?? ""),
            notes: String(formData.get("notes") ?? "") || null,
            inputs: draft.payload.inputs.map((line) => ({
              ...line,
              actualConsumedQty: Number(formData.get(`consumed-${line.id}`)),
              wasteQty: Number(formData.get(`waste-${line.id}`)),
            })),
          },
        };
      }
      const saved = await saveDraft(applyDraftEvent(edited, { type: "edit" }));
      onSaved(saved);
      setMessage("Saved on this device. The stable sync key and server snapshot were preserved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Draft could not be saved.");
    }
  }

  return (
    <form action={saveEdits} className="mt-4 space-y-3 border-t pt-4">
      {draft.type === "recount" ? (
        <>
          {draft.payload.lines.map((line) => (
            <div key={line.itemId} className="grid gap-2 sm:grid-cols-[1fr_10rem] sm:items-end">
              <div className="text-sm">
                <p className="font-medium">{line.itemName ?? "Inventory item"}</p>
                <p className="text-muted-foreground">{line.sku}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`physical-${draft.id}-${line.itemId}`}>Physical quantity</Label>
                <Input
                  id={`physical-${draft.id}-${line.itemId}`}
                  name={`physical-${line.itemId}`}
                  type="number"
                  min="0"
                  max="9999999999"
                  step="0.0001"
                  defaultValue={line.physicalQty}
                  required
                />
              </div>
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor={`draft-reason-${draft.id}`}>Recount reason</Label>
            <Input
              id={`draft-reason-${draft.id}`}
              name="reason"
              defaultValue={draft.payload.reason}
              minLength={3}
              maxLength={1000}
              required
            />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`output-${draft.id}`}>Actual output</Label>
              <Input
                id={`output-${draft.id}`}
                name="actualOutputQty"
                type="number"
                min="0.0001"
                step="0.0001"
                defaultValue={draft.payload.actualOutputQty}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`lot-${draft.id}`}>Output lot</Label>
              <Input
                id={`lot-${draft.id}`}
                name="outputLotNumber"
                defaultValue={draft.payload.outputLotNumber}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`production-date-${draft.id}`}>Production date</Label>
              <Input
                id={`production-date-${draft.id}`}
                name="productionDate"
                type="date"
                defaultValue={draft.payload.productionDate}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`expiration-date-${draft.id}`}>Expiration date</Label>
              <Input
                id={`expiration-date-${draft.id}`}
                name="expirationDate"
                type="date"
                defaultValue={draft.payload.expirationDate}
                required
              />
            </div>
          </div>
          {draft.payload.inputs.map((line) => (
            <div key={line.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
              <div className="text-sm">
                <p className="font-medium">{line.itemName ?? "Production input"}</p>
                <p className="text-muted-foreground">{line.unitCode}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`consumed-${draft.id}-${line.id}`}>Consumed</Label>
                <Input
                  id={`consumed-${draft.id}-${line.id}`}
                  name={`consumed-${line.id}`}
                  type="number"
                  min="0"
                  step="0.0001"
                  defaultValue={line.actualConsumedQty}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`waste-${draft.id}-${line.id}`}>Waste</Label>
                <Input
                  id={`waste-${draft.id}-${line.id}`}
                  name={`waste-${line.id}`}
                  type="number"
                  min="0"
                  step="0.0001"
                  defaultValue={line.wasteQty}
                  required
                />
              </div>
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor={`notes-${draft.id}`}>Notes</Label>
            <Input id={`notes-${draft.id}`} name="notes" defaultValue={draft.payload.notes ?? ""} />
          </div>
        </>
      )}
      <Button type="submit" variant="outline" size="sm">
        <Save className="size-4" />
        Save device edits
      </Button>
      {message && <p className="text-muted-foreground text-sm">{message}</p>}
    </form>
  );
}

export function OfflineDrafts({
  branches,
  items,
  productionOrders,
  businessDate,
  canRecount,
  canProduction,
}: {
  branches: OfflineBranchOption[];
  items: OfflineItemOption[];
  productionOrders: OfflineProductionOrderOption[];
  businessDate: string;
  canRecount: boolean;
  canProduction: boolean;
}) {
  const [drafts, setDrafts] = useState<OfflineDraft[]>([]);
  const [online, setOnline] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedProductionId, setSelectedProductionId] = useState(productionOrders[0]?.id ?? "");
  const selectedProduction = useMemo(
    () => productionOrders.find((order) => order.id === selectedProductionId),
    [productionOrders, selectedProductionId],
  );

  async function refreshDrafts() {
    try {
      setDrafts(await listDrafts());
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Offline storage is unavailable.");
    }
  }

  useEffect(() => {
    void refreshDrafts();
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function prepareRecount(formData: FormData) {
    const item = items.find((candidate) => candidate.id === formData.get("itemId"));
    const branch = branches.find((candidate) => candidate.id === formData.get("branchId"));
    if (!item || !branch) return setNotice("Choose a branch and item.");
    if (!online) return setNotice("Connect once to obtain a server snapshot before starting.");
    const draftId = crypto.randomUUID();
    const response = await issueOfflineSnapshotAction({
      type: "recount",
      branchId: branch.id,
      clientDraftId: draftId,
      itemIds: [item.id],
    });
    if (!response.snapshot) return setNotice(response.error ?? "Snapshot could not be issued.");
    const identity = createDraftIdentity(response.snapshot, draftId);
    await saveDraft({
      ...identity,
      type: "recount",
      label: `${branch.name} · ${item.name}`,
      payload: {
        branchId: branch.id,
        branchName: branch.name,
        businessDate: String(formData.get("businessDate")),
        reason: String(formData.get("reason")),
        lines: [
          {
            itemId: item.id,
            itemName: item.name,
            sku: item.sku,
            unitCode: item.unitCode,
            physicalQty: Number(formData.get("physicalQty")),
          },
        ],
      },
    });
    setNotice("Recount draft saved on this device. You can edit it while offline.");
    await refreshDrafts();
  }

  async function prepareProduction(formData: FormData) {
    const order = selectedProduction;
    if (!order) return setNotice("Choose an in-progress production order.");
    if (!online) return setNotice("Connect once to obtain a server snapshot before starting.");
    const draftId = crypto.randomUUID();
    const response = await issueOfflineSnapshotAction({
      type: "production",
      branchId: order.branchId,
      clientDraftId: draftId,
      productionOrderId: order.id,
    });
    if (!response.snapshot) return setNotice(response.error ?? "Snapshot could not be issued.");
    const identity = createDraftIdentity(response.snapshot, draftId);
    await saveDraft({
      ...identity,
      type: "production",
      label: `${order.reference} · ${order.outputName}`,
      payload: {
        productionOrderId: order.id,
        productionOrderReference: order.reference,
        actualOutputQty: Number(formData.get("actualOutputQty")),
        outputLotNumber: String(formData.get("outputLotNumber")),
        productionDate: String(formData.get("productionDate")),
        expirationDate: String(formData.get("expirationDate")),
        notes: String(formData.get("notes") ?? "") || null,
        inputs: order.inputs.map((input) => ({
          id: input.id,
          itemName: input.itemName,
          unitCode: input.unitCode,
          actualConsumedQty: Number(formData.get(`consumed-${input.id}`)),
          wasteQty: Number(formData.get(`waste-${input.id}`)),
          notes: null,
        })),
      },
    });
    setNotice("Production draft saved on this device. Existing confirmation is still required.");
    await refreshDrafts();
  }

  async function syncDraft(draft: OfflineDraft) {
    if (!online) {
      await transitionDraft(draft.id, { type: "queue" });
      setNotice("Draft queued. Its stable key will be reused when you reconnect.");
      await refreshDrafts();
      return;
    }
    await transitionDraft(draft.id, { type: "sync_start" });
    await refreshDrafts();
    const response = await syncOfflineDraftAction({
      type: draft.type,
      id: draft.id,
      idempotencyKey: draft.idempotencyKey,
      snapshotId: draft.snapshotId,
      snapshotAt: draft.snapshotAt,
      clientCreatedAt: draft.clientCreatedAt,
      payload: draft.payload,
    });
    if (response.error) {
      await transitionDraft(draft.id, { type: "sync_error", message: response.error });
    } else if (response.status === "review_required") {
      await transitionDraft(draft.id, {
        type: "review",
        reference: response.reference ?? "Server review",
        message: response.info ?? "Explicit review is required.",
      });
    } else {
      await transitionDraft(draft.id, {
        type: "sync_success",
        reference: response.reference ?? "Synchronized",
      });
    }
    setNotice(response.error ?? response.info ?? "Synchronization finished.");
    await refreshDrafts();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <FilePenLine className="size-5 text-green-600" />
          <CardTitle>Offline drafts and sync queue</CardTitle>
          <Badge variant={online ? "secondary" : "destructive"}>
            {online ? <Cloud className="size-3" /> : <CloudOff className="size-3" />}
            {online ? "Online" : "Offline"}
          </Badge>
        </div>
        <CardDescription>
          Prepare a server-scoped draft while connected, edit it on this device offline, and retry
          with the same idempotency key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {storageError && (
          <Alert variant="destructive">
            <AlertTitle>Device draft storage unavailable</AlertTitle>
            <AlertDescription>{storageError}</AlertDescription>
          </Alert>
        )}
        {!online && (
          <Alert>
            <CloudOff className="size-4 text-amber-600" />
            <AlertTitle>Working offline</AlertTitle>
            <AlertDescription>
              Device edits remain local. Sync requests are not simulated or cached.
            </AlertDescription>
          </Alert>
        )}
        {notice && (
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {notice}
          </p>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          {canRecount && (
            <form action={prepareRecount} className="space-y-3 rounded-lg border p-4">
              <div>
                <h3 className="font-semibold">Prepare recount draft</h3>
                <p className="text-muted-foreground text-sm">
                  The initial quantity can be edited later without changing the server snapshot.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="offline-recount-branch">Branch</Label>
                  <select
                    id="offline-recount-branch"
                    name="branchId"
                    className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                    required
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="offline-recount-date">Business date</Label>
                  <Input
                    id="offline-recount-date"
                    name="businessDate"
                    type="date"
                    defaultValue={businessDate}
                    max={businessDate}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="offline-recount-item">Inventory item</Label>
                <select
                  id="offline-recount-item"
                  name="itemId"
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                  required
                >
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name} ({item.unitCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="offline-recount-qty">Physical quantity</Label>
                  <Input
                    id="offline-recount-qty"
                    name="physicalQty"
                    type="number"
                    min="0"
                    step="0.0001"
                    defaultValue="0"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="offline-recount-reason">Reason</Label>
                  <Input
                    id="offline-recount-reason"
                    name="reason"
                    minLength={3}
                    maxLength={1000}
                    defaultValue="Offline physical count"
                    required
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={!online || pending || items.length === 0 || branches.length === 0}
              >
                <Save className="size-4" />
                Save device draft
              </Button>
            </form>
          )}

          {canProduction && (
            <form action={prepareProduction} className="space-y-3 rounded-lg border p-4">
              <div>
                <h3 className="font-semibold">Prepare production draft</h3>
                <p className="text-muted-foreground text-sm">
                  Sync records actuals only; online confirmation still posts inventory.
                </p>
              </div>
              {productionOrders.length === 0 ? (
                <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                  No in-progress production order is available.
                </p>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="offline-production-order">In-progress order</Label>
                    <select
                      id="offline-production-order"
                      value={selectedProductionId}
                      onChange={(event) => setSelectedProductionId(event.target.value)}
                      className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                    >
                      {productionOrders.map((order) => (
                        <option key={order.id} value={order.id}>
                          {order.reference} — {order.outputName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="offline-production-output">Actual output</Label>
                      <Input
                        id="offline-production-output"
                        name="actualOutputQty"
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        defaultValue={selectedProduction?.plannedOutputQty ?? 1}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="offline-production-lot">Output lot</Label>
                      <Input
                        id="offline-production-lot"
                        name="outputLotNumber"
                        placeholder="Batch or lot number"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="offline-production-date">Production date</Label>
                      <Input
                        id="offline-production-date"
                        name="productionDate"
                        type="date"
                        defaultValue={businessDate}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="offline-production-expiry">Expiration date</Label>
                      <Input
                        id="offline-production-expiry"
                        name="expirationDate"
                        type="date"
                        defaultValue={businessDate}
                        min={businessDate}
                        required
                      />
                    </div>
                  </div>
                  {selectedProduction?.inputs.map((input) => (
                    <div key={input.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
                      <div className="text-sm">
                        <p className="font-medium">{input.itemName}</p>
                        <p className="text-muted-foreground">
                          Planned {input.plannedQty} {input.unitCode}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`new-consumed-${input.id}`}>Consumed</Label>
                        <Input
                          id={`new-consumed-${input.id}`}
                          name={`consumed-${input.id}`}
                          type="number"
                          min="0"
                          step="0.0001"
                          defaultValue={input.plannedQty}
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`new-waste-${input.id}`}>Waste</Label>
                        <Input
                          id={`new-waste-${input.id}`}
                          name={`waste-${input.id}`}
                          type="number"
                          min="0"
                          step="0.0001"
                          defaultValue="0"
                          required
                        />
                      </div>
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label htmlFor="offline-production-notes">Notes</Label>
                    <Input id="offline-production-notes" name="notes" />
                  </div>
                  <Button type="submit" disabled={!online || pending}>
                    <Factory className="size-4" />
                    Save device draft
                  </Button>
                </>
              )}
            </form>
          )}
        </div>

        <section className="space-y-3" aria-labelledby="device-queue-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 id="device-queue-heading" className="font-semibold">
                Device queue
              </h3>
              <Badge variant="secondary">{drafts.length}</Badge>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshDrafts()}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
          {drafts.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
              No drafts are stored on this device.
            </div>
          ) : (
            drafts.map((draft) => (
              <div key={draft.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{draft.label}</p>
                    <p className="text-muted-foreground text-sm">
                      {draft.type === "recount" ? "Recount" : "Production"} · snapshot{" "}
                      {new Date(draft.snapshotAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant={stateBadge(draft.state)}>
                    {draft.state.replaceAll("_", " ")}
                  </Badge>
                </div>
                {draft.serverReference && (
                  <p className="font-data mt-2 text-sm">
                    Server reference: {draft.serverReference}
                  </p>
                )}
                {draft.lastError && (
                  <p className="text-destructive mt-2 text-sm">{draft.lastError}</p>
                )}
                {draft.state !== "synced" && draft.state !== "review_required" && (
                  <DraftEditor
                    draft={draft}
                    onSaved={(saved) =>
                      setDrafts((current) =>
                        current.map((item) => (item.id === saved.id ? saved : item)),
                      )
                    }
                  />
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {draft.state !== "synced" && draft.state !== "review_required" && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(() => {
                          void syncDraft(draft);
                        })
                      }
                    >
                      {online ? <Cloud className="size-4" /> : <CloudOff className="size-4" />}
                      {online ? "Sync with server" : "Queue for sync"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Delete the device copy of ${draft.label}? Server records are unaffected.`,
                        )
                      )
                        return;
                      startTransition(async () => {
                        await removeDraft(draft.id);
                        await refreshDrafts();
                      });
                    }}
                  >
                    <Trash2 className="size-4" />
                    Delete device copy
                  </Button>
                </div>
              </div>
            ))
          )}
        </section>
      </CardContent>
    </Card>
  );
}
