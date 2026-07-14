import { describe, expect, it } from "vitest";
import { applyDraftEvent } from "@/lib/offline/draft-store";
import { parseCsvRecords, parseLoyverseCsv, PosCsvError } from "@/lib/pos/csv";
import { offlineDraftSchema, posPreviewSchema, type OfflineDraft } from "@/lib/validation/phase10";

const HEADER =
  "external_reference,external_line_id,occurred_at,type,entity_type,external_id,quantity";

function draft(): OfflineDraft {
  return offlineDraftSchema.parse({
    id: "10000000-0000-4000-8000-000000000001",
    idempotencyKey: "10000000-0000-4000-8000-000000000002",
    snapshotId: "10000000-0000-4000-8000-000000000003",
    label: "Main · Coffee beans",
    snapshotAt: "2026-07-14T04:00:00.000Z",
    clientCreatedAt: "2026-07-14T04:01:00.000Z",
    createdAt: "2026-07-14T04:01:00.000Z",
    updatedAt: "2026-07-14T04:01:00.000Z",
    state: "draft",
    serverReference: null,
    lastError: null,
    type: "recount",
    payload: {
      branchId: "10000000-0000-4000-8000-000000000004",
      businessDate: "2026-07-14",
      reason: "Offline count",
      lines: [{ itemId: "10000000-0000-4000-8000-000000000005", physicalQty: 95.125 }],
    },
  });
}

describe("Phase 10 CSV parser", () => {
  it("parses escaped commas, quotes, CRLF, and quoted newlines", () => {
    const records = parseCsvRecords('a,b\r\n"coffee, iced","say ""hi""\nagain"\r\n');
    expect(records).toEqual([
      ["a", "b"],
      ["coffee, iced", 'say "hi"\nagain'],
    ]);
  });

  it("normalizes a valid Loyverse preview row", () => {
    const rows = parseLoyverseCsv(
      `${HEADER}\nSALE-1,LINE-1,2026-07-14T12:00:00+08:00,SALE,VARIANT,var-1,2.5000`,
    );
    expect(rows).toEqual([
      {
        rowNumber: 2,
        externalReference: "SALE-1",
        externalLineId: "LINE-1",
        occurredAt: "2026-07-14T12:00:00+08:00",
        movementType: "sale",
        entityType: "variant",
        externalId: "var-1",
        quantity: 2.5,
      },
    ]);
  });

  it("rejects wrong headers, duplicate external lines, and unterminated quotes", () => {
    expect(() => parseLoyverseCsv(`wrong,headers\n1,2`)).toThrow(PosCsvError);
    expect(() =>
      parseLoyverseCsv(
        `${HEADER}\nS-1,L-1,2026-07-14T12:00:00+08:00,sale,item,x,1\nS-1,L-1,2026-07-14T12:01:00+08:00,sale,item,x,1`,
      ),
    ).toThrow(/unique/i);
    expect(() => parseCsvRecords('a,"broken')).toThrow(/unterminated/i);
  });

  it("caps previews at 500 rows", () => {
    const row = "S,L,2026-07-14T12:00:00+08:00,sale,item,x,1";
    expect(() =>
      parseLoyverseCsv([HEADER, ...Array.from({ length: 501 }, () => row)].join("\n")),
    ).toThrow(/500/);
    expect(
      posPreviewSchema.safeParse({
        branchId: crypto.randomUUID(),
        filename: "loyverse.csv",
        idempotencyKey: crypto.randomUUID(),
        rows: [],
      }).success,
    ).toBe(false);
  });
});

describe("Phase 10 device queue", () => {
  it("preserves stable draft, snapshot, and idempotency keys across retries", () => {
    const original = draft();
    const syncing = applyDraftEvent(original, { type: "sync_start" });
    const failed = applyDraftEvent(syncing, { type: "sync_error", message: "Network lost" });
    const queued = applyDraftEvent(failed, { type: "queue" });
    expect(queued.id).toBe(original.id);
    expect(queued.snapshotId).toBe(original.snapshotId);
    expect(queued.idempotencyKey).toBe(original.idempotencyKey);
    expect(queued.state).toBe("queued");
  });

  it("records review and success without changing the stable submission identity", () => {
    const original = draft();
    const review = applyDraftEvent(original, {
      type: "review",
      reference: "OFF-20260714-000001",
      message: "Inventory moved",
    });
    expect(review.state).toBe("review_required");
    expect(review.serverReference).toMatch(/^OFF-/);
    expect(review.idempotencyKey).toBe(original.idempotencyKey);

    const success = applyDraftEvent(original, {
      type: "sync_success",
      reference: "OFF-20260714-000002",
    });
    expect(success.state).toBe("synced");
    expect(success.lastError).toBeNull();
  });
});
