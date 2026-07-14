"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, Link2, ShieldCheck, Upload } from "lucide-react";
import {
  confirmPosImportAction,
  deactivateLoyverseMappingAction,
  previewPosImportAction,
  upsertLoyverseMappingAction,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  OfflineBranchOption,
  OfflineItemOption,
} from "@/components/offline-pos/offline-drafts";

export type LoyverseMappingView = {
  id: string;
  entityType: "item" | "variant" | "modifier";
  externalId: string;
  externalName: string | null;
  externalSku: string | null;
  itemName: string;
  itemSku: string;
  inventoryQty: number;
  active: boolean;
};

export type PosImportRowView = {
  rowNumber: number;
  externalReference: string;
  externalLineId: string;
  movementType: "sale" | "refund";
  entityType: "item" | "variant" | "modifier";
  externalId: string;
  quantity: number;
  inventoryQty: number | null;
  validationStatus: "valid" | "unmapped" | "duplicate" | "invalid";
  validationError: string | null;
  itemName: string | null;
  itemSku: string | null;
};

export type PosImportView = {
  id: string;
  reference: string;
  branchName: string;
  filename: string;
  status: "preview" | "confirmed";
  rowCount: number;
  validCount: number;
  errorCount: number;
  previewedAt: string;
  confirmedAt: string | null;
  rows: PosImportRowView[];
};

function MappingForm({ items }: { items: OfflineItemOption[] }) {
  const [state, action, pending] = useActionState<Phase10ActionState, FormData>(
    upsertLoyverseMappingAction,
    {},
  );
  const [key, setKey] = useState(() => crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.info) return;
    formRef.current?.reset();
    setKey(crypto.randomUUID());
  }, [state.info]);

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg border p-4">
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="mapping-entity-type">Loyverse entity</Label>
          <select
            id="mapping-entity-type"
            name="entityType"
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="item">Item</option>
            <option value="variant">Variant</option>
            <option value="modifier">Modifier</option>
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="mapping-external-id">External ID</Label>
          <Input id="mapping-external-id" name="externalId" maxLength={200} required />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="mapping-name">External name</Label>
          <Input id="mapping-name" name="externalName" maxLength={200} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mapping-sku">External SKU</Label>
          <Input id="mapping-sku" name="externalSku" maxLength={100} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-1">
          <Label htmlFor="mapping-item">Internal inventory item</Label>
          <select
            id="mapping-item"
            name="inventoryItemId"
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            required
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} — {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mapping-qty">Base qty / sale</Label>
          <Input
            id="mapping-qty"
            name="inventoryQty"
            type="number"
            min="0.0001"
            step="0.0001"
            defaultValue="1"
            required
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="mapping-reason">Mapping reason</Label>
        <Input
          id="mapping-reason"
          name="reason"
          minLength={3}
          maxLength={1000}
          defaultValue="Loyverse catalog mapping"
          required
        />
      </div>
      <Button type="submit" disabled={pending || items.length === 0}>
        <Link2 className="size-4" />
        {pending ? "Saving…" : "Save mapping"}
      </Button>
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      {state.info && <p className="text-sm text-green-700 dark:text-green-300">{state.info}</p>}
    </form>
  );
}

function DeactivateMapping({ mapping }: { mapping: LoyverseMappingView }) {
  const [state, action, pending] = useActionState<Phase10ActionState, FormData>(
    deactivateLoyverseMappingAction,
    {},
  );
  const [key] = useState(() => crypto.randomUUID());
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Deactivate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate {mapping.externalId}?</DialogTitle>
          <DialogDescription>
            Future previews will treat this entity as unmapped. Confirmed ledger history remains
            unchanged.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="mappingId" value={mapping.id} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <div className="space-y-1">
            <Label htmlFor={`deactivate-${mapping.id}`}>Reason</Label>
            <Input
              id={`deactivate-${mapping.id}`}
              name="reason"
              minLength={3}
              maxLength={1000}
              defaultValue="Loyverse mapping no longer active"
              required
            />
          </div>
          {state.error && <p className="text-destructive text-sm">{state.error}</p>}
          {state.info && <p className="text-sm">{state.info}</p>}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Deactivating…" : "Confirm deactivation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmImport({ value }: { value: PosImportView }) {
  const [state, action, pending] = useActionState<Phase10ActionState, FormData>(
    confirmPosImportAction,
    {},
  );
  const [key] = useState(() => crypto.randomUUID());
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" disabled={value.errorCount > 0 || value.status !== "preview"}>
          <ShieldCheck className="size-4" />
          Confirm posting
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post {value.reference} to inventory?</DialogTitle>
          <DialogDescription>
            This explicit step will create {value.rowCount} append-only POS ledger transaction
            {value.rowCount === 1 ? "" : "s"}. It cannot edit prior entries.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="importId" value={value.id} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <div className="space-y-1">
            <Label htmlFor={`confirm-${value.id}`}>Confirmation reason</Label>
            <textarea
              id={`confirm-${value.id}`}
              name="reason"
              className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
              minLength={3}
              maxLength={1000}
              defaultValue="Reviewed Loyverse CSV preview and mappings"
              required
            />
          </div>
          {state.error && <p className="text-destructive text-sm">{state.error}</p>}
          {state.info && <p className="text-sm text-green-700 dark:text-green-300">{state.info}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Posting atomically…" : "Confirm inventory posting"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PosWorkspace({
  branches,
  items,
  mappings,
  imports,
}: {
  branches: OfflineBranchOption[];
  items: OfflineItemOption[];
  mappings: LoyverseMappingView[];
  imports: PosImportView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<Phase10ActionState>({});
  const [previewKey, setPreviewKey] = useState(() => crypto.randomUUID());

  async function previewCsv(formData: FormData) {
    const file = formData.get("csv");
    if (!(file instanceof File) || file.size === 0)
      return setPreview({ error: "Choose a CSV file." });
    const csvText = await file.text();
    const response = await previewPosImportAction({
      branchId: formData.get("branchId"),
      filename: file.name,
      idempotencyKey: previewKey,
      csvText,
    });
    setPreview(response);
    if (!response.error) {
      setPreviewKey(crypto.randomUUID());
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="size-5 text-green-600" />
          <CardTitle>Loyverse staging and CSV import</CardTitle>
        </div>
        <CardDescription>
          Mappings and previews are staging only. Inventory changes only after an explicit,
          idempotent confirmation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <FileCheck2 className="size-4 text-green-600" />
          <AlertTitle>No live POS connection</AlertTitle>
          <AlertDescription>
            Phase 10 stores no Loyverse credentials and performs no API calls, polling, webhooks, or
            background imports.
          </AlertDescription>
        </Alert>

        <section className="space-y-3" aria-labelledby="loyverse-mappings-heading">
          <div className="flex items-center gap-2">
            <h3 id="loyverse-mappings-heading" className="font-semibold">
              Loyverse mappings
            </h3>
            <Badge variant="secondary">{mappings.length}</Badge>
          </div>
          <MappingForm items={items} />
          {mappings.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-sm">
              No Loyverse entities are mapped yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3">External entity</th>
                    <th className="p-3">Name / SKU</th>
                    <th className="p-3">Internal item</th>
                    <th className="p-3">Base quantity</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => (
                    <tr key={mapping.id} className="border-t">
                      <td className="p-3">
                        <span className="capitalize">{mapping.entityType}</span> ·{" "}
                        <span className="font-data">{mapping.externalId}</span>
                      </td>
                      <td className="p-3">
                        {mapping.externalName ?? "—"}
                        <br />
                        <span className="text-muted-foreground">
                          {mapping.externalSku ?? "No external SKU"}
                        </span>
                      </td>
                      <td className="p-3">
                        {mapping.itemName}
                        <br />
                        <span className="text-muted-foreground">{mapping.itemSku}</span>
                      </td>
                      <td className="font-data p-3">{mapping.inventoryQty}</td>
                      <td className="p-3">
                        <Badge variant={mapping.active ? "default" : "secondary"}>
                          {mapping.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {mapping.active && <DeactivateMapping mapping={mapping} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="pos-preview-heading">
          <h3 id="pos-preview-heading" className="font-semibold">
            CSV preview
          </h3>
          <form
            action={(formData) =>
              startTransition(() => {
                void previewCsv(formData);
              })
            }
            className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <div className="space-y-1">
              <Label htmlFor="pos-branch">Posting branch</Label>
              <select
                id="pos-branch"
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
              <Label htmlFor="pos-csv">UTF-8 Loyverse CSV</Label>
              <Input id="pos-csv" name="csv" type="file" accept=".csv,text/csv" required />
            </div>
            <Button type="submit" disabled={pending || branches.length === 0}>
              {pending ? "Validating…" : "Generate preview"}
            </Button>
          </form>
          <p className="text-muted-foreground text-xs">
            Exact headers: external_reference, external_line_id, occurred_at, type, entity_type,
            external_id, quantity. Maximum 1 MiB / 500 rows.
          </p>
          {preview.error && (
            <Alert variant="destructive">
              <AlertTitle>Preview failed</AlertTitle>
              <AlertDescription>{preview.error}</AlertDescription>
            </Alert>
          )}
          {preview.info && (
            <Alert>
              <AlertTitle>Preview created</AlertTitle>
              <AlertDescription>{preview.info}</AlertDescription>
            </Alert>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="pos-imports-heading">
          <div className="flex items-center gap-2">
            <h3 id="pos-imports-heading" className="font-semibold">
              Staged imports
            </h3>
            <Badge variant="secondary">{imports.length}</Badge>
          </div>
          {imports.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
              No CSV preview has been generated.
            </p>
          ) : (
            imports.map((value) => (
              <div key={value.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-data font-semibold">{value.reference}</p>
                    <p className="text-muted-foreground text-sm">
                      {value.branchName} · {value.filename}
                    </p>
                  </div>
                  <Badge
                    variant={
                      value.status === "confirmed"
                        ? "default"
                        : value.errorCount > 0
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {value.status}
                  </Badge>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <p>{value.rowCount} rows</p>
                  <p className="text-green-700 dark:text-green-300">{value.validCount} valid</p>
                  <p className={value.errorCount ? "text-destructive" : "text-muted-foreground"}>
                    {value.errorCount} warnings
                  </p>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[780px] text-left text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2">Line</th>
                        <th className="p-2">Movement</th>
                        <th className="p-2">External entity</th>
                        <th className="p-2">Mapped item</th>
                        <th className="p-2">Quantity</th>
                        <th className="p-2">Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.rows.map((row) => (
                        <tr key={`${row.rowNumber}-${row.externalLineId}`} className="border-t">
                          <td className="p-2">
                            {row.externalReference}
                            <br />
                            <span className="text-muted-foreground font-data">
                              {row.externalLineId}
                            </span>
                          </td>
                          <td className="p-2 capitalize">{row.movementType}</td>
                          <td className="p-2">
                            <span className="capitalize">{row.entityType}</span> ·{" "}
                            <span className="font-data">{row.externalId}</span>
                          </td>
                          <td className="p-2">
                            {row.itemName ?? "—"}
                            <br />
                            <span className="text-muted-foreground">{row.itemSku}</span>
                          </td>
                          <td className="font-data p-2">
                            {row.quantity} → {row.inventoryQty ?? "—"}
                          </td>
                          <td className="p-2">
                            <Badge
                              variant={row.validationStatus === "valid" ? "default" : "destructive"}
                            >
                              {row.validationStatus}
                            </Badge>
                            {row.validationError && (
                              <p className="text-destructive mt-1 text-xs">{row.validationError}</p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {value.status === "preview" && <ConfirmImport value={value} />}
                {value.status === "preview" && value.errorCount > 0 && (
                  <p className="text-destructive text-sm">
                    Confirmation is disabled. Correct mappings or duplicate lines, then generate a
                    new preview.
                  </p>
                )}
              </div>
            ))
          )}
        </section>
      </CardContent>
    </Card>
  );
}
