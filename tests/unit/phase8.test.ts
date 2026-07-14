import { describe, expect, it } from "vitest";
import { manilaLocalToUtc, utcToManilaLocal } from "@/lib/calendar/time";
import {
  notificationRequiresEmail,
  notificationSeverity,
  type NotificationSource,
} from "@/lib/notifications/severity";
import { dashboardFilterSchema, popupCountLineSchema } from "@/lib/validation/phase8";

describe("Phase 8 notification severity", () => {
  const expected: Array<[NotificationSource, "critical" | "warning" | "info"]> = [
    ["negative_inventory", "critical"],
    ["expired_lot", "critical"],
    ["failed_production", "critical"],
    ["overdue_recount", "warning"],
    ["unusual_recount", "warning"],
    ["out_of_stock", "warning"],
    ["pending_stock_request", "warning"],
    ["low_stock", "info"],
  ];

  it.each(expected)("maps %s to %s", (source, severity) => {
    expect(notificationSeverity(source)).toBe(severity);
    expect(notificationRequiresEmail(source)).toBe(severity === "critical");
  });
});

describe("Phase 8 dates and reconciliation validation", () => {
  it("converts Manila business input to UTC and back", () => {
    expect(manilaLocalToUtc("2026-07-14T09:00")).toBe("2026-07-14T01:00:00.000Z");
    expect(utcToManilaLocal("2026-07-14T01:00:00.000Z")).toBe("2026-07-14T09:00");
  });

  it("accepts a balanced popup line and rejects an unbalanced line", () => {
    const base = {
      itemId: crypto.randomUUID(),
      unitId: crypto.randomUUID(),
      transferredInQty: 10,
      remainingQty: 3,
      returnedQty: 3,
      consumedQty: 5,
      wasteQty: 1,
      lossQty: 1,
      gainQty: 0,
      endingQty: 0,
      notes: null,
    };
    expect(popupCountLineSchema.safeParse(base).success).toBe(true);
    expect(popupCountLineSchema.safeParse({ ...base, remainingQty: 4 }).success).toBe(false);
  });

  it("rejects reversed or overlong dashboard ranges", () => {
    expect(
      dashboardFilterSchema.safeParse({
        startDate: "2026-07-14",
        endDate: "2026-07-13",
        branchId: null,
        categoryId: null,
        itemType: null,
      }).success,
    ).toBe(false);
    expect(
      dashboardFilterSchema.safeParse({
        startDate: "2025-01-01",
        endDate: "2026-07-14",
        branchId: null,
        categoryId: null,
        itemType: null,
      }).success,
    ).toBe(false);
  });
});
