"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, CheckCheck, CircleAlert, Info, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  setNotificationReceiptAction,
  type NotificationActionState,
} from "@/app/(app)/notifications/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHumanDateTime } from "@/lib/format";
import {
  notificationSeverityLabel,
  notificationSourceLabel,
  type NotificationSeverity,
  type NotificationSource,
} from "@/lib/notifications/severity";

export interface NotificationRow {
  id: string;
  reference: string;
  severity: NotificationSeverity;
  source_type: NotificationSource;
  status: string;
  title: string;
  message: string;
  entity_reference: string | null;
  email_required: boolean;
  first_raised_at: string;
  last_raised_at: string;
  raise_count: number;
  readAt: string | null;
  acknowledgedAt: string | null;
  emailStatus: string | null;
}

function ReceiptForm({
  notification,
  acknowledge,
}: {
  notification: NotificationRow;
  acknowledge: boolean;
}) {
  const [token, setToken] = useState(() => crypto.randomUUID());
  const [state, action] = useActionState<NotificationActionState, FormData>(
    setNotificationReceiptAction,
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
    <form action={action}>
      <input type="hidden" name="notificationId" value={notification.id} />
      <input type="hidden" name="acknowledge" value={String(acknowledge)} />
      <input type="hidden" name="idempotencyKey" value={token} />
      <Button type="submit" size="sm" variant={acknowledge ? "default" : "outline"}>
        {acknowledge ? <CheckCheck className="size-4" /> : null}
        {acknowledge ? "Acknowledge" : "Mark read"}
      </Button>
    </form>
  );
}

function SeverityIcon({ severity }: { severity: NotificationSeverity }) {
  if (severity === "critical") return <CircleAlert className="text-destructive size-5" />;
  if (severity === "warning") return <TriangleAlert className="size-5 text-amber-600" />;
  return <Info className="size-5 text-sky-600" />;
}

export function NotificationsClient({
  notifications,
  loadError,
}: {
  notifications: NotificationRow[];
  loadError: boolean;
}) {
  const [severity, setSeverity] = useState<"all" | NotificationSeverity>("all");
  const visible = notifications.filter(
    (notification) => severity === "all" || notification.severity === severity,
  );
  const critical = notifications.filter(
    (notification) => notification.severity === "critical",
  ).length;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">In-app + email delivery</p>
        <h1 className="font-display mt-1 text-3xl">Notifications</h1>
        <p className="text-muted-foreground mt-1">
          Conditions are deduplicated while active. Reading or acknowledging never hides a Critical
          alert.
        </p>
      </div>
      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Notification refresh was incomplete</AlertTitle>
          <AlertDescription>
            Previously persisted alerts are shown. Critical email remains queued for a safe retry.
          </AlertDescription>
        </Alert>
      )}
      {critical > 0 && (
        <Alert variant="destructive" className="border-destructive/70">
          <CircleAlert className="size-4" />
          <AlertTitle>
            {critical} active Critical alert{critical === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            Investigate the underlying inventory or production condition even if it has been
            acknowledged.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="flex flex-wrap gap-2 pt-6">
          {(["all", "critical", "warning", "info"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={severity === value ? "default" : "outline"}
              onClick={() => setSeverity(value)}
            >
              {value === "all" ? "All" : notificationSeverityLabel(value)}
            </Button>
          ))}
        </CardContent>
      </Card>
      {notifications.length === 0 && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>No active notifications</AlertTitle>
          <AlertDescription>
            Operational producers found no current conditions in your role and branch scope.
          </AlertDescription>
        </Alert>
      )}
      {notifications.length > 0 && visible.length === 0 && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>No notifications at this severity</AlertTitle>
          <AlertDescription>Choose another filter to see active conditions.</AlertDescription>
        </Alert>
      )}
      <div className="space-y-4">
        {visible.map((notification) => (
          <Card
            key={notification.id}
            className={
              notification.severity === "critical"
                ? "border-destructive/70"
                : notification.readAt
                  ? "opacity-80"
                  : "border-primary/50"
            }
          >
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <SeverityIcon severity={notification.severity} />
                <div>
                  <CardTitle>{notification.title}</CardTitle>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {notification.reference} · {notificationSourceLabel(notification.source_type)}
                  </p>
                </div>
              </div>
              <Badge variant={notification.severity === "critical" ? "destructive" : "outline"}>
                {notificationSeverityLabel(notification.severity)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>{notification.message}</p>
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>Last raised {formatHumanDateTime(notification.last_raised_at)}</span>
                {notification.raise_count > 1 && (
                  <span>
                    Re-raised {notification.raise_count - 1} time
                    {notification.raise_count === 2 ? "" : "s"}
                  </span>
                )}
                {notification.entity_reference && (
                  <span>Reference {notification.entity_reference}</span>
                )}
                {notification.email_required && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="size-3" /> Email {notification.emailStatus ?? "queued"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!notification.readAt && (
                  <ReceiptForm notification={notification} acknowledge={false} />
                )}
                {!notification.acknowledgedAt && (
                  <ReceiptForm notification={notification} acknowledge />
                )}
                {notification.acknowledgedAt && (
                  <Badge variant="secondary">
                    Acknowledged {formatHumanDateTime(notification.acknowledgedAt)}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
