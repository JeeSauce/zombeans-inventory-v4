"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { CalendarDays, Info, MapPin, Store } from "lucide-react";
import { toast } from "sonner";
import { createPopupEventAction, type PopupActionState } from "@/app/(app)/popups/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUSINESS_TIME_ZONE } from "@/lib/calendar/time";
import { formatHumanDateTime } from "@/lib/format";
import { formatInTimeZone } from "date-fns-tz";

export interface PopupListRow {
  id: string;
  reference: string;
  status: "planned" | "in_progress" | "reconciling" | "completed" | "cancelled";
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  popupBranchName: string;
  returnBranchName: string;
  notes: string | null;
}
type Branch = { id: string; name: string };

function PopupCreateForm({
  popupBranches,
  returnBranches,
}: {
  popupBranches: Branch[];
  returnBranches: Branch[];
}) {
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [state, action] = useActionState<PopupActionState, FormData>(createPopupEventAction, {});
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) {
      toast.success(state.info);
      setToken(crypto.randomUUID());
    }
  }, [state.error, state.info]);
  const start = formatInTimeZone(
    new Date(Date.now() + 86_400_000),
    BUSINESS_TIME_ZONE,
    "yyyy-MM-dd'T'09:00",
  );
  const end = formatInTimeZone(
    new Date(Date.now() + 86_400_000),
    BUSINESS_TIME_ZONE,
    "yyyy-MM-dd'T'17:00",
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create popup engagement</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="idempotencyKey" value={token} />
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="popup-title">Title</Label>
            <Input id="popup-title" name="title" placeholder="Weekend market popup" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="popup-location">Location</Label>
            <Input id="popup-location" name="location" required />
          </div>
          <label className="space-y-2 text-sm">
            <span>Popup branch</span>
            <select
              className="border-input bg-background h-9 w-full rounded-md border px-3"
              name="popupBranchId"
              required
            >
              {popupBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span>Return to</span>
            <select
              className="border-input bg-background h-9 w-full rounded-md border px-3"
              name="returnBranchId"
              required
            >
              {returnBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2">
            <Label htmlFor="popup-start">Starts (Asia/Manila)</Label>
            <Input
              id="popup-start"
              type="datetime-local"
              name="startsAtLocal"
              defaultValue={start}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="popup-end">Ends (Asia/Manila)</Label>
            <Input
              id="popup-end"
              type="datetime-local"
              name="endsAtLocal"
              defaultValue={end}
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="popup-description">Description</Label>
            <textarea
              id="popup-description"
              name="description"
              className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="popup-notes">Operating notes</Label>
            <textarea
              id="popup-notes"
              name="notes"
              className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
            />
          </div>
          <Button
            className="sm:col-span-2 sm:justify-self-end"
            type="submit"
            disabled={!popupBranches.length || !returnBranches.length}
          >
            Create engagement
          </Button>
        </form>
        {(!popupBranches.length || !returnBranches.length) && (
          <p className="text-destructive mt-3 text-sm">
            The permanent Popup and Main branches must both be active.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function PopupsClient({
  sessions,
  popupBranches,
  returnBranches,
  canManage,
  loadError,
}: {
  sessions: PopupListRow[];
  popupBranches: Branch[];
  returnBranches: Branch[];
  canManage: boolean;
  loadError: boolean;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Engagement inventory sessions</p>
        <h1 className="font-display mt-1 text-3xl">Popup events</h1>
        <p className="text-muted-foreground mt-1">
          Zombeans Popup is the permanent branch; each engagement has its own count and
          ledger-backed summary.
        </p>
      </div>
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Popup sessions are incomplete</AlertTitle>
          <AlertDescription>Retry before changing an engagement.</AlertDescription>
        </Alert>
      )}
      {!canManage && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Read-only popup view</AlertTitle>
          <AlertDescription>
            Super Admin and Branch Manager manage engagements. Inventory still moves only through
            the Stock workflows.
          </AlertDescription>
        </Alert>
      )}
      {canManage && (
        <PopupCreateForm popupBranches={popupBranches} returnBranches={returnBranches} />
      )}
      {sessions.length === 0 && (
        <Alert>
          <Store className="size-4" />
          <AlertTitle>No popup engagements</AlertTitle>
          <AlertDescription>
            {canManage ? "Create the first engagement above." : "No engagement has been scheduled."}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {sessions.map((session) => (
          <Link key={session.id} href={`/popups/${session.id}`}>
            <Card className="hover:border-primary/60 h-full transition-colors">
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>{session.title}</CardTitle>
                  <p className="font-data text-muted-foreground mt-1 text-xs">
                    {session.reference}
                  </p>
                </div>
                <Badge
                  variant={
                    session.status === "cancelled"
                      ? "destructive"
                      : session.status === "completed"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {session.status.replaceAll("_", " ")}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="flex items-center gap-2">
                  <CalendarDays className="size-4" /> {formatHumanDateTime(session.startsAt)}
                </p>
                <p className="flex items-center gap-2">
                  <MapPin className="size-4" /> {session.location ?? "Location pending"}
                </p>
                <p className="text-muted-foreground">
                  {session.popupBranchName} · returns to {session.returnBranchName}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
