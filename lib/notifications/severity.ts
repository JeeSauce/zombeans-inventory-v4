export const NOTIFICATION_SOURCES = [
  "negative_inventory",
  "expired_lot",
  "overdue_recount",
  "unusual_recount",
  "failed_production",
  "low_stock",
  "out_of_stock",
  "pending_stock_request",
] as const;

export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];
export type NotificationSeverity = "critical" | "warning" | "info";

const SEVERITY_BY_SOURCE: Record<NotificationSource, NotificationSeverity> = {
  negative_inventory: "critical",
  expired_lot: "critical",
  failed_production: "critical",
  overdue_recount: "warning",
  unusual_recount: "warning",
  out_of_stock: "warning",
  pending_stock_request: "warning",
  low_stock: "info",
};

export function notificationSeverity(source: NotificationSource): NotificationSeverity {
  return SEVERITY_BY_SOURCE[source];
}

export function notificationRequiresEmail(source: NotificationSource): boolean {
  return notificationSeverity(source) === "critical";
}

export function notificationSeverityLabel(severity: NotificationSeverity): string {
  return severity[0]?.toUpperCase() + severity.slice(1);
}

export function notificationSourceLabel(source: NotificationSource): string {
  return source
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
