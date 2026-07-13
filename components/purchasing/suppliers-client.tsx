"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import {
  createSupplierAction,
  updateSupplierAction,
  type SupplierActionState,
} from "@/app/(app)/purchasing/suppliers/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface SupplierRow {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  lead_time_days: number;
  payment_terms: string | null;
  active: boolean;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** Shared field set; the owning dialog supplies the bound form action + its error state. */
function SupplierFields({
  state,
  formAction,
  supplier,
  submitLabel,
}: {
  state: SupplierActionState;
  formAction: (fd: FormData) => void;
  supplier?: SupplierRow;
  submitLabel: string;
}) {
  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="name">Supplier name</Label>
        <Input id="name" name="name" defaultValue={supplier?.name} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="contactName">Contact name</Label>
          <Input id="contactName" name="contactName" defaultValue={supplier?.contact_name ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactPhone">Contact phone</Label>
          <Input
            id="contactPhone"
            name="contactPhone"
            defaultValue={supplier?.contact_phone ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactEmail">Contact email</Label>
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={supplier?.contact_email ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="leadTimeDays">Lead time (days)</Label>
          <Input
            id="leadTimeDays"
            name="leadTimeDays"
            type="number"
            min="0"
            step="1"
            defaultValue={supplier?.lead_time_days ?? 0}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="paymentTerms">Payment terms</Label>
        <Input
          id="paymentTerms"
          name="paymentTerms"
          placeholder="e.g. Net 30"
          defaultValue={supplier?.payment_terms ?? ""}
        />
      </div>
      <div className="rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={supplier?.active ?? true}
            className="accent-primary"
          />
          Active
        </label>
      </div>
      <div className="flex justify-end">
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}

function CreateSupplierDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SupplierActionState, FormData>(
    createSupplierAction,
    {},
  );

  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> Add supplier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New supplier</DialogTitle>
        </DialogHeader>
        <SupplierFields state={state} formAction={formAction} submitLabel="Create supplier" />
      </DialogContent>
    </Dialog>
  );
}

function EditSupplierDialog({ supplier }: { supplier: SupplierRow }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SupplierActionState, FormData>(
    updateSupplierAction.bind(null, supplier.id),
    {},
  );

  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {supplier.name}</DialogTitle>
        </DialogHeader>
        <SupplierFields
          state={state}
          formAction={formAction}
          supplier={supplier}
          submitLabel="Save changes"
        />
      </DialogContent>
    </Dialog>
  );
}

function ContactCell({ supplier }: { supplier: SupplierRow }) {
  if (!supplier.contact_name && !supplier.contact_email && !supplier.contact_phone) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="text-sm">
      {supplier.contact_name && <div>{supplier.contact_name}</div>}
      {(supplier.contact_email || supplier.contact_phone) && (
        <div className="text-muted-foreground text-xs">
          {[supplier.contact_email, supplier.contact_phone].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

export function SuppliersClient({
  suppliers,
  canWrite,
}: {
  suppliers: SupplierRow[];
  canWrite: boolean;
}) {
  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <CreateSupplierDialog />
        </div>
      )}
      {suppliers.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No suppliers yet.{" "}
          {canWrite ? "Add your first vendor to start purchasing." : "Ask an admin to add one."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Lead time</TableHead>
                <TableHead>Status</TableHead>
                {canWrite && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <ContactCell supplier={s} />
                  </TableCell>
                  <TableCell className="font-data text-xs">
                    {s.lead_time_days} {s.lead_time_days === 1 ? "day" : "days"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.active ? "default" : "destructive"}>
                      {s.active ? "active" : "inactive"}
                    </Badge>
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <EditSupplierDialog supplier={s} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
