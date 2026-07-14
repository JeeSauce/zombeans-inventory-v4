"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Info, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  createCalendarEventAction,
  updateCalendarEventAction,
  type CalendarActionState,
} from "@/app/(app)/calendar/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUSINESS_TIME_ZONE, utcToManilaLocal } from "@/lib/calendar/time";
import { formatHumanDateTime } from "@/lib/format";
import { CALENDAR_EVENT_STATUSES, CALENDAR_EVENT_TYPES } from "@/lib/validation/phase8";
import { cn } from "@/lib/utils";

export interface CalendarEventRow {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  location: string | null;
  eventType: (typeof CALENDAR_EVENT_TYPES)[number];
  status: (typeof CALENDAR_EVENT_STATUSES)[number];
  branchId: string | null;
  branchName: string | null;
  startsAt: string;
  endsAt: string;
  version: number;
}

type Branch = { id: string; name: string };
type View = "month" | "week" | "agenda";
const dateKey = (date: Date | string) =>
  formatInTimeZone(new Date(date), BUSINESS_TIME_ZONE, "yyyy-MM-dd");

function FormFields({ event, branches }: { event?: CalendarEventRow; branches: Branch[] }) {
  const nowLocal = formatInTimeZone(new Date(), BUSINESS_TIME_ZONE, "yyyy-MM-dd'T'HH:mm");
  const later = formatInTimeZone(
    new Date(Date.now() + 3_600_000),
    BUSINESS_TIME_ZONE,
    "yyyy-MM-dd'T'HH:mm",
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${event?.id ?? "new"}-title`}>Title</Label>
        <Input
          id={`${event?.id ?? "new"}-title`}
          name="title"
          defaultValue={event?.title ?? ""}
          maxLength={160}
          required
        />
      </div>
      <label className="space-y-2 text-sm">
        <span>Type</span>
        <select
          className="border-input bg-background h-9 w-full rounded-md border px-3"
          name="eventType"
          defaultValue={event?.eventType ?? "operation"}
        >
          {CALENDAR_EVENT_TYPES.filter(
            (type) => !event || type === event.eventType || type !== "popup",
          ).map((type) => (
            <option key={type} value={type}>
              {type.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {event && (
        <label className="space-y-2 text-sm">
          <span>Status</span>
          <select
            className="border-input bg-background h-9 w-full rounded-md border px-3"
            name="status"
            defaultValue={event.status}
          >
            {CALENDAR_EVENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="space-y-2 text-sm">
        <span>Branch</span>
        <select
          className="border-input bg-background h-9 w-full rounded-md border px-3"
          name="branchId"
          defaultValue={event?.branchId ?? ""}
        >
          <option value="">All branches</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-2">
        <Label htmlFor={`${event?.id ?? "new"}-location`}>Location</Label>
        <Input
          id={`${event?.id ?? "new"}-location`}
          name="location"
          defaultValue={event?.location ?? ""}
          maxLength={240}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${event?.id ?? "new"}-start`}>Starts (Asia/Manila)</Label>
        <Input
          id={`${event?.id ?? "new"}-start`}
          name="startsAtLocal"
          type="datetime-local"
          defaultValue={event ? utcToManilaLocal(event.startsAt) : nowLocal}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${event?.id ?? "new"}-end`}>Ends (Asia/Manila)</Label>
        <Input
          id={`${event?.id ?? "new"}-end`}
          name="endsAtLocal"
          type="datetime-local"
          defaultValue={event ? utcToManilaLocal(event.endsAt) : later}
          required
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${event?.id ?? "new"}-description`}>Description</Label>
        <textarea
          id={`${event?.id ?? "new"}-description`}
          name="description"
          defaultValue={event?.description ?? ""}
          maxLength={2000}
          className="border-input bg-background min-h-24 w-full rounded-md border p-3 text-sm"
        />
      </div>
    </div>
  );
}

function CreateEventForm({ branches }: { branches: Branch[] }) {
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [state, action] = useActionState<CalendarActionState, FormData>(
    createCalendarEventAction,
    {},
  );
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) {
      toast.success(state.info);
      setToken(crypto.randomUUID());
    }
  }, [state.error, state.info]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create calendar event</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="idempotencyKey" value={token} />
          <FormFields branches={branches} />
          <Button type="submit">Create event</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EditEventForm({ event, branches }: { event: CalendarEventRow; branches: Branch[] }) {
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [state, action] = useActionState<CalendarActionState, FormData>(
    updateCalendarEventAction,
    {},
  );
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.info) {
      toast.success(state.info);
      setToken(crypto.randomUUID());
    }
  }, [state.error, state.info]);
  return (
    <details className="mt-3 rounded-lg border p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Pencil className="size-4" /> Edit event
      </summary>
      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="eventId" value={event.id} />
        <input type="hidden" name="expectedVersion" value={event.version} />
        <input type="hidden" name="idempotencyKey" value={token} />
        <FormFields event={event} branches={branches} />
        <Button type="submit">Save changes</Button>
      </form>
    </details>
  );
}

function EventCard({
  event,
  canManage,
  branches,
}: {
  event: CalendarEventRow;
  canManage: boolean;
  branches: Branch[];
}) {
  return (
    <Card
      className={
        event.status === "cancelled"
          ? "opacity-60"
          : event.eventType === "popup"
            ? "border-primary/60"
            : undefined
      }
    >
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>{event.title}</CardTitle>
          <p className="font-data text-muted-foreground mt-1 text-xs">{event.reference}</p>
        </div>
        <Badge variant={event.status === "cancelled" ? "destructive" : "outline"}>
          {event.status.replaceAll("_", " ")}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="flex items-center gap-2">
          <Clock className="size-4" /> {formatHumanDateTime(event.startsAt)} –{" "}
          {formatHumanDateTime(event.endsAt)}
        </p>
        <p className="flex items-center gap-2">
          <MapPin className="size-4" /> {event.location ?? event.branchName ?? "All branches"}
        </p>
        {event.description && <p className="text-muted-foreground">{event.description}</p>}
        <Badge variant="secondary">{event.eventType}</Badge>
        {canManage &&
          event.status !== "completed" &&
          event.status !== "cancelled" &&
          event.eventType !== "popup" && <EditEventForm event={event} branches={branches} />}
      </CardContent>
    </Card>
  );
}

export function CalendarClient({
  events,
  branches,
  canManage,
  loadError,
}: {
  events: CalendarEventRow[];
  branches: Branch[];
  canManage: boolean;
  loadError: boolean;
}) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const monthDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(cursor)),
        end: endOfWeek(endOfMonth(cursor)),
      }),
    [cursor],
  );
  const weekDays = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) }),
    [cursor],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    for (const event of events)
      map.set(dateKey(event.startsAt), [...(map.get(dateKey(event.startsAt)) ?? []), event]);
    return map;
  }, [events]);
  const navigate = (direction: number) =>
    setCursor((date) => (view === "week" ? addWeeks(date, direction) : addMonths(date, direction)));
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Asia/Manila operations</p>
        <h1 className="font-display mt-1 text-3xl">Calendar</h1>
        <p className="text-muted-foreground mt-1">
          Stored in UTC, presented in the business timezone.
        </p>
      </div>
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Calendar data is incomplete</AlertTitle>
          <AlertDescription>Retry before relying on the schedule.</AlertDescription>
        </Alert>
      )}
      {!canManage && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Read-only calendar</AlertTitle>
          <AlertDescription>
            Super Admin and Branch Manager can create or edit. Your events remain fully visible in
            scope.
          </AlertDescription>
        </Alert>
      )}
      {canManage && <CreateEventForm branches={branches} />}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex gap-2">
            {(["month", "week", "agenda"] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                variant={view === item ? "default" : "outline"}
                onClick={() => setView(item)}
              >
                {item}
              </Button>
            ))}
          </div>
          {view !== "agenda" && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous period"
                onClick={() => navigate(-1)}
              >
                <ChevronLeft />
              </Button>
              <span className="min-w-36 text-center font-medium">
                {formatInTimeZone(
                  cursor,
                  BUSINESS_TIME_ZONE,
                  view === "month" ? "MMMM yyyy" : "MMM d, yyyy",
                )}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next period"
                onClick={() => navigate(1)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {events.length === 0 && (
        <Alert>
          <CalendarDays className="size-4" />
          <AlertTitle>No calendar events</AlertTitle>
          <AlertDescription>
            {canManage
              ? "Create the first operational event above."
              : "A manager has not scheduled an event yet."}
          </AlertDescription>
        </Alert>
      )}
      {view === "month" && events.length > 0 && (
        <div className="bg-card grid grid-cols-7 overflow-hidden rounded-xl border">
          {monthDays.map((day) => {
            const dayEvents = byDay.get(dateKey(day)) ?? [];
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "min-h-28 border-r border-b p-2 last:border-r-0",
                  !isSameMonth(day, cursor) && "bg-muted/30 text-muted-foreground",
                )}
              >
                <p className="text-xs font-medium">
                  {formatInTimeZone(day, BUSINESS_TIME_ZONE, "d")}
                </p>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 3).map((event) => (
                    <div
                      key={event.id}
                      className="bg-secondary truncate rounded px-1.5 py-1 text-[0.7rem]"
                      title={event.title}
                    >
                      {event.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <p className="text-muted-foreground text-[0.65rem]">
                      +{dayEvents.length - 3} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {view === "week" && events.length > 0 && (
        <div className="grid gap-3 md:grid-cols-7">
          {weekDays.map((day) => (
            <Card key={day.toISOString()}>
              <CardHeader>
                <CardTitle className="text-sm">
                  {formatInTimeZone(day, BUSINESS_TIME_ZONE, "EEE d")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(byDay.get(dateKey(day)) ?? []).map((event) => (
                  <div key={event.id} className="rounded border p-2 text-xs">
                    <p className="font-medium">{event.title}</p>
                    <p className="text-muted-foreground">
                      {formatInTimeZone(new Date(event.startsAt), BUSINESS_TIME_ZONE, "h:mm a")}
                    </p>
                  </div>
                ))}
                {(byDay.get(dateKey(day)) ?? []).length === 0 && (
                  <p className="text-muted-foreground text-xs">No events</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {view === "agenda" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {events.map((event) => (
            <EventCard key={event.id} event={event} canManage={canManage} branches={branches} />
          ))}
        </div>
      )}
      {view !== "agenda" && events.length > 0 && (
        <div>
          <h2 className="font-display mb-3 text-xl">Event details</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {events
              .filter((event) =>
                view === "month"
                  ? dateKey(event.startsAt).startsWith(
                      formatInTimeZone(cursor, BUSINESS_TIME_ZONE, "yyyy-MM"),
                    )
                  : weekDays.some((day) => dateKey(day) === dateKey(event.startsAt)),
              )
              .map((event) => (
                <EventCard key={event.id} event={event} canManage={canManage} branches={branches} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
