"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Lock, Plus } from "lucide-react";
import {
  createUserAction,
  setUserStatusAction,
  type UserActionState,
} from "@/app/(app)/admin/users/actions";
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

export interface UserRow {
  id: string;
  fullName: string;
  email: string;
  status: "active" | "disabled";
  isProtected: boolean;
  roles: { key: string; name: string }[];
}

const ROLE_OPTIONS = [
  { key: "super_admin", name: "Super Admin" },
  { key: "branch_manager", name: "Branch Manager" },
  { key: "production", name: "Production Staff" },
  { key: "inventory", name: "Inventory Staff" },
];

function CreateSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create account"}
    </Button>
  );
}

function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<UserActionState, FormData>(createUserAction, {});

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
          <Plus className="size-4" /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New staff account</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Roles</legend>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((r) => (
                <label
                  key={r.key}
                  className="has-[:checked]:border-primary has-[:checked]:bg-secondary/40 flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <input type="checkbox" name="roleKeys" value={r.key} className="accent-primary" />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end">
            <CreateSubmit />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusToggle({ user, disabled }: { user: UserRow; disabled: boolean }) {
  const [pending, start] = useTransition();
  const next = user.status === "active" ? "disabled" : "active";
  return (
    <Button
      variant={user.status === "active" ? "outline" : "default"}
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const res = await setUserStatusAction(user.id, next);
          if (res.error) toast.error(res.error);
          else if (res.info) toast.success(res.info);
        })
      }
    >
      {user.status === "active" ? "Disable" : "Enable"}
    </Button>
  );
}

export function UsersClient({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateUserDialog />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    {u.fullName}
                    {u.isProtected && (
                      <Lock
                        className="text-muted-foreground size-3"
                        aria-label="Protected account"
                      />
                    )}
                  </span>
                </TableCell>
                <TableCell className="font-data text-muted-foreground text-xs">{u.email}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.key} variant="secondary">
                        {r.name}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={u.status === "active" ? "default" : "destructive"}>
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {u.isProtected || u.id === currentUserId ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    <StatusToggle user={u} disabled={false} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
