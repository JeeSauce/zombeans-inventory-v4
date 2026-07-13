export type ProductionStatus =
  "draft" | "in_progress" | "awaiting_confirmation" | "completed" | "cancelled";

export function productionStatusVariant(
  status: ProductionStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "completed":
      return "default";
    case "cancelled":
      return "destructive";
    case "awaiting_confirmation":
      return "outline";
    default:
      return "secondary";
  }
}
