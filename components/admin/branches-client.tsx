"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus, Pencil, Star } from "lucide-react";
import {
  createBranchAction,
  updateBranchAction,
  type BranchActionState,
} from "@/app/(app)/admin/branches/actions";
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

export interface BranchRow {
  id: string;
  key: string;
  name: string;
  is_main: boolean;
  holds_raw_ingredients: boolean;
  active: boolean;
}

function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="accent-primary"
      />
      {label}
    </label>
  );
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
function BranchFields({
  state,
  formAction,
  branch,
  submitLabel,
}: {
  state: BranchActionState;
  formAction: (fd: FormData) => void;
  branch?: BranchRow;
  submitLabel: string;
}) {
  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="name">Branch name</Label>
          <Input id="name" name="name" defaultValue={branch?.name} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="key">Key</Label>
          <Input
            id="key"
            name="key"
            defaultValue={branch?.key}
            placeholder="e.g. san-carlos"
            className="font-data"
            required
          />
        </div>
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <CheckboxField
          name="isMain"
          label="Main branch (central commissary / warehouse)"
          defaultChecked={branch?.is_main}
        />
        <CheckboxField
          name="holdsRawIngredients"
          label="Holds raw ingredients"
          defaultChecked={branch?.holds_raw_ingredients}
        />
        <CheckboxField name="active" label="Active" defaultChecked={branch?.active ?? true} />
      </div>
      <div className="flex justify-end">
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}

function CreateBranchDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<BranchActionState, FormData>(createBranchAction, {});

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
          <Plus className="size-4" /> Add branch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New branch</DialogTitle>
        </DialogHeader>
        <BranchFields state={state} formAction={formAction} submitLabel="Create branch" />
      </DialogContent>
    </Dialog>
  );
}

function EditBranchDialog({ branch }: { branch: BranchRow }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<BranchActionState, FormData>(
    updateBranchAction.bind(null, branch.id),
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
          <DialogTitle>Edit {branch.name}</DialogTitle>
        </DialogHeader>
        <BranchFields
          state={state}
          formAction={formAction}
          branch={branch}
          submitLabel="Save changes"
        />
      </DialogContent>
    </Dialog>
  );
}

export function BranchesClient({ branches }: { branches: BranchRow[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateBranchDialog />
      </div>
      {branches.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          No branches yet. Add your first location to start tracking prices and stock.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {b.is_main && (
                        <Star className="text-primary size-3.5" aria-label="Main branch" />
                      )}
                      {b.name}
                    </span>
                  </TableCell>
                  <TableCell className="font-data text-muted-foreground text-xs">{b.key}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {b.is_main && <Badge variant="secondary">Commissary</Badge>}
                      {b.holds_raw_ingredients && <Badge variant="outline">Raw stock</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={b.active ? "default" : "destructive"}>
                      {b.active ? "active" : "inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <EditBranchDialog branch={b} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
