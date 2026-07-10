import { describe, it, expect } from "vitest";
import { formatPeso, formatFormDate, formatHumanDate } from "@/lib/format";

describe("localization formatting", () => {
  it("formats PHP currency as ₱1,234.56", () => {
    expect(formatPeso(1234.56)).toBe("₱1,234.56");
  });

  it("formats form dates as MM/DD/YYYY in Asia/Manila", () => {
    // 2026-07-10T00:00:00+08:00 → still July 10 in Manila
    expect(formatFormDate("2026-07-09T16:30:00.000Z")).toBe("07/10/2026");
  });

  it("formats human dates as Month D, YYYY", () => {
    expect(formatHumanDate("2026-07-09T16:30:00.000Z")).toBe("July 10, 2026");
  });
});
