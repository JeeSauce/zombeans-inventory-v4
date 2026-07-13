export type PoStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "partially_received"
  | "fully_received"
  | "closed"
  | "cancelled";

export function statusBadgeVariant(
  status: PoStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "draft":
      return "secondary";
    case "submitted":
      return "outline";
    case "approved":
    case "fully_received":
      return "default";
    case "partially_received":
      return "outline";
    case "cancelled":
      return "destructive";
    case "closed":
      return "secondary";
    default:
      return "secondary";
  }
}
