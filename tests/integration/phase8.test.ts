import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, assignRole, cleanupUsers, connect, createUser } from "./helpers/db";

const EMAIL_LIKE = "phase8+%@zombeans.test";
const DEDUP_LIKE = "phase8:%";
let admin: Client;
let acting: Client;
const users = { super: "", manager: "", production: "", inventory: "" };
const fixture = { main: "", popup: "", unit: "", category: "", item: "" };

async function runAsUserAndCommit<T>(
  userId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await acting.query("begin");
  try {
    await acting.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await acting.query("set local role authenticated");
    const result = await fn(acting);
    await acting.query("commit");
    return result;
  } catch (error) {
    await acting.query("rollback");
    throw error;
  }
}

async function cleanupPhase8(): Promise<void> {
  await admin.query("alter table public.notification_events disable trigger user");
  await admin.query("alter table public.calendar_event_commands disable trigger user");
  await admin.query("alter table public.popup_event_commands disable trigger user");
  await admin.query("alter table public.popup_event_movements disable trigger user");
  try {
    await admin.query(`delete from public.notifications where dedup_key like $1`, [DEDUP_LIKE]);
    await admin.query(`delete from public.popup_event_commands where popup_event_id in (
      select pe.id from public.popup_event_sessions pe
      join public.calendar_events ce on ce.id = pe.calendar_event_id where ce.title like 'P8 %'
    )`);
    await admin.query(`delete from public.popup_event_movements where popup_event_id in (
      select pe.id from public.popup_event_sessions pe
      join public.calendar_events ce on ce.id = pe.calendar_event_id where ce.title like 'P8 %'
    )`);
    await admin.query(`delete from public.popup_event_count_lines where popup_event_id in (
      select pe.id from public.popup_event_sessions pe
      join public.calendar_events ce on ce.id = pe.calendar_event_id where ce.title like 'P8 %'
    )`);
    await admin.query(`update public.transfers set popup_event_id = null where popup_event_id in (
      select pe.id from public.popup_event_sessions pe
      join public.calendar_events ce on ce.id = pe.calendar_event_id where ce.title like 'P8 %'
    )`);
    await admin.query(`delete from public.popup_event_sessions where calendar_event_id in (
      select id from public.calendar_events where title like 'P8 %'
    )`);
    await admin.query(`delete from public.calendar_event_commands where event_id in (
      select id from public.calendar_events where title like 'P8 %'
    )`);
    await admin.query(`delete from public.calendar_events where title like 'P8 %'`);
    await admin.query(
      `delete from public.audit_logs where actor_id in (
      select id from public.profiles where email like $1
    ) and (action like 'calendar.%' or action like 'popup.%')`,
      [EMAIL_LIKE],
    );
    await admin.query(`delete from public.inventory_balances where item_id in (
      select id from public.inventory_items where sku = 'P8-GATE-ITEM'
    )`);
    await admin.query(`delete from public.inventory_items where sku = 'P8-GATE-ITEM'`);
    await admin.query(`delete from public.categories where name = 'P8 Gate Category'`);
  } finally {
    await admin.query("alter table public.notification_events enable trigger user");
    await admin.query("alter table public.calendar_event_commands enable trigger user");
    await admin.query("alter table public.popup_event_commands enable trigger user");
    await admin.query("alter table public.popup_event_movements enable trigger user");
  }
  await cleanupUsers(admin, EMAIL_LIKE);
}

async function raise(
  source: string,
  key: string,
  targetUser = users.manager,
): Promise<{ notification_id: string; severity: string; raise_count: number }> {
  const result = await admin.query<{
    result: { notification_id: string; severity: string; raise_count: number };
  }>(
    `select public.raise_notification(
      $1::public.notification_source_type, $2, $3, 'phase8_gate', null, $4,
      $5, null, null, $6
    ) result`,
    [
      source,
      `P8 ${source}`,
      `Safe ${source.replaceAll("_", " ")} condition`,
      `P8-${source}`,
      key,
      targetUser,
    ],
  );
  return result.rows[0]!.result;
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupPhase8();
  users.super = await createUser(admin, "phase8+super@zombeans.test", { fullName: "P8 Super" });
  users.manager = await createUser(admin, "phase8+manager@zombeans.test", {
    fullName: "P8 Manager",
  });
  users.production = await createUser(admin, "phase8+production@zombeans.test", {
    fullName: "P8 Production",
  });
  users.inventory = await createUser(admin, "phase8+inventory@zombeans.test", {
    fullName: "P8 Inventory",
  });
  await assignRole(admin, users.super, "super_admin");
  await assignRole(admin, users.manager, "branch_manager");
  await assignRole(admin, users.production, "production");
  await assignRole(admin, users.inventory, "inventory");
  const branches = await admin.query<{ id: string; key: string }>(
    `select id, key from public.branches where key in ('commissary', 'popup')`,
  );
  fixture.main = branches.rows.find((branch) => branch.key === "commissary")!.id;
  fixture.popup = branches.rows.find((branch) => branch.key === "popup")!.id;
  fixture.unit = (
    await admin.query<{ id: string }>(`select id from public.units where code = 'pc'`)
  ).rows[0]!.id;
  fixture.category = (
    await admin.query<{ id: string }>(
      `insert into public.categories (name, item_type, created_by, updated_by) values ('P8 Gate Category', 'packaging', $1, $1) returning id`,
      [users.super],
    )
  ).rows[0]!.id;
  fixture.item = (
    await admin.query<{ id: string }>(
      `insert into public.inventory_items (name, sku, item_type, category_id, base_unit_id, low_stock_threshold, reorder_level, weighted_avg_cost, created_by, updated_by) values ('P8 Gate Cups', 'P8-GATE-ITEM', 'packaging', $1, $2, 2, 4, 20, $3, $3) returning id`,
      [fixture.category, fixture.unit, users.super],
    )
  ).rows[0]!.id;
  await admin.query(
    `insert into public.inventory_balances (item_id, branch_id, qty_on_hand) values ($1, $2, 5)`,
    [fixture.item, fixture.main],
  );
}, 60_000);

afterAll(async () => {
  await cleanupPhase8();
  await admin.end();
  await acting.end();
});

describe("Phase 8 notification gate", () => {
  it("deduplicates one active condition and one email delivery per recipient", async () => {
    const key = `phase8:dedup:${crypto.randomUUID()}`;
    const first = await raise("negative_inventory", key);
    const second = await raise("negative_inventory", key);
    expect(second.notification_id).toBe(first.notification_id);
    expect(second.raise_count).toBe(2);
    const projection = await admin.query(
      `select
      (select count(*)::int from public.notifications where dedup_key=$1 and status='active') active_count,
      (select raise_count from public.notifications where id=$2) raise_count,
      (select count(*)::int from public.notification_events where notification_id=$2 and event_type in ('raised','reraised')) raise_events,
      (select count(*)::int from public.notification_deliveries where notification_id=$2 and channel='email') email_deliveries`,
      [key, first.notification_id],
    );
    expect(projection.rows[0]).toEqual({
      active_count: 1,
      raise_count: 2,
      raise_events: 2,
      email_deliveries: 1,
    });
  });

  it("maps every producer severity and queues email only for Critical", async () => {
    const sources = [
      "negative_inventory",
      "expired_lot",
      "failed_production",
      "overdue_recount",
      "unusual_recount",
      "out_of_stock",
      "pending_stock_request",
      "low_stock",
    ] as const;
    const expected = [
      "critical",
      "critical",
      "critical",
      "warning",
      "warning",
      "warning",
      "warning",
      "info",
    ];
    for (const [index, source] of sources.entries()) {
      const raised = await raise(source, `phase8:severity:${source}:${crypto.randomUUID()}`);
      expect(raised.severity).toBe(expected[index]);
      const delivery = await admin.query<{ count: number }>(
        `select count(*)::int count from public.notification_deliveries where notification_id=$1 and channel='email'`,
        [raised.notification_id],
      );
      expect(delivery.rows[0]!.count).toBe(expected[index] === "critical" ? 1 : 0);
    }
  });

  it("claims and finalizes Critical email delivery exactly once", async () => {
    const raised = await raise("expired_lot", `phase8:email:${crypto.randomUUID()}`);
    await admin.query(
      `update public.notification_deliveries
       set created_at = '2000-01-01T00:00:00Z'
       where notification_id=$1 and channel='email'`,
      [raised.notification_id],
    );
    const claimToken = crypto.randomUUID();
    const claimed = await admin.query<{
      delivery_id: string;
      notification_id: string;
      recipient_address: string;
    }>(`select * from public.claim_notification_email_deliveries($1, 20)`, [claimToken]);
    const delivery = claimed.rows.find((row) => row.notification_id === raised.notification_id);
    expect(delivery?.recipient_address).toBe("phase8+manager@zombeans.test");
    await admin.query(`select public.finalize_notification_email_delivery($1,$2,true,$3,null)`, [
      delivery!.delivery_id,
      claimToken,
      `phase8-provider-${crypto.randomUUID()}`,
    ]);
    const persisted = await admin.query<{ status: string; attempt_count: number }>(
      `select status, attempt_count from public.notification_deliveries where id=$1`,
      [delivery!.delivery_id],
    );
    expect(persisted.rows[0]).toEqual({ status: "delivered", attempt_count: 1 });
    const replay = await admin.query(
      `select * from public.claim_notification_email_deliveries($1, 20)`,
      [crypto.randomUUID()],
    );
    expect(replay.rows.some((row) => row.notification_id === raised.notification_id)).toBe(false);
  });

  it("preserves resolved history and permits a new active occurrence", async () => {
    const key = `phase8:resolve:${crypto.randomUUID()}`;
    const first = await raise("failed_production", key);
    await admin.query(`select public.resolve_notification($1, 'Condition investigated', $2)`, [
      key,
      crypto.randomUUID(),
    ]);
    const second = await raise("failed_production", key);
    expect(second.notification_id).not.toBe(first.notification_id);
    const rows = await admin.query(
      `select status from public.notifications where dedup_key=$1 order by created_at`,
      [key],
    );
    expect(rows.rows.map((row) => row.status).sort()).toEqual(["active", "resolved"]);
  });

  it("enforces target RLS and idempotent own read/ack state", async () => {
    const raised = await raise("low_stock", `phase8:target:${crypto.randomUUID()}`);
    const managerRows = await asUser(
      acting,
      users.manager,
      async (client) =>
        (
          await client.query(`select id from public.notifications where id=$1`, [
            raised.notification_id,
          ])
        ).rows,
    );
    const inventoryRows = await asUser(
      acting,
      users.inventory,
      async (client) =>
        (
          await client.query(`select id from public.notifications where id=$1`, [
            raised.notification_id,
          ])
        ).rows,
    );
    expect(managerRows).toHaveLength(1);
    expect(inventoryRows).toHaveLength(0);
    const key = crypto.randomUUID();
    await runAsUserAndCommit(users.manager, (client) =>
      client.query(`select public.set_notification_receipt_state($1, true, $2)`, [
        raised.notification_id,
        key,
      ]),
    );
    await runAsUserAndCommit(users.manager, (client) =>
      client.query(`select public.set_notification_receipt_state($1, true, $2)`, [
        raised.notification_id,
        key,
      ]),
    );
    const events = await admin.query<{ count: number }>(
      `select count(*)::int count from public.notification_events where notification_id=$1 and idempotency_key=$2`,
      [raised.notification_id, key],
    );
    expect(events.rows[0]!.count).toBe(1);
    await expect(
      asUser(acting, users.manager, (client) =>
        client.query(
          `update public.notification_receipts set read_at=now() where notification_id=$1`,
          [raised.notification_id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Phase 8 dashboard role-gating gate", () => {
  it.each([
    ["Branch Manager", "manager"],
    ["Production Staff", "production"],
    ["Inventory Staff", "inventory"],
  ] as const)("denies direct financial API reads for %s", async (_label, role) => {
    await expect(
      asUser(acting, users[role], (client) =>
        client.query(`select public.get_dashboard_financials($1,$2,null)`, [
          fixture.main,
          fixture.category,
        ]),
      ),
    ).rejects.toThrow(/cost\.read required/i);
  });

  it("returns exact valuation to Super Admin and no financial key operationally", async () => {
    const financial = await asUser(
      acting,
      users.super,
      async (client) =>
        (
          await client.query<{ data: { inventory_value: number; valued_item_count: number } }>(
            `select public.get_dashboard_financials($1,$2,null) data`,
            [fixture.main, fixture.category],
          )
        ).rows[0]!.data,
    );
    expect(Number(financial.inventory_value)).toBe(100);
    expect(financial.valued_item_count).toBe(1);
    const operational = await asUser(
      acting,
      users.inventory,
      async (client) =>
        (
          await client.query<{ data: Record<string, unknown> }>(
            `select public.get_dashboard_operational(current_date-6,current_date,$1,$2,null) data`,
            [fixture.main, fixture.category],
          )
        ).rows[0]!.data,
    );
    expect(JSON.stringify(operational)).not.toMatch(/inventory_value|weighted_avg_cost|unit_cost/i);
  });
});

describe("Phase 8 calendar and popup authorization", () => {
  it("allows manager create/read replay but denies Inventory Staff mutation", async () => {
    const key = crypto.randomUUID();
    const first = await runAsUserAndCommit(users.manager, (client) =>
      client.query<{ data: { event_id: string; reference: string } }>(
        `select public.create_calendar_event('P8 Calendar Gate', null, 'Main', 'operation', $1, now()+interval '1 day', now()+interval '2 days', $2) data`,
        [fixture.main, key],
      ),
    );
    const second = await runAsUserAndCommit(users.manager, (client) =>
      client.query<{ data: { event_id: string } }>(
        `select public.create_calendar_event('P8 Calendar Gate', null, 'Main', 'operation', $1, now()+interval '1 day', now()+interval '2 days', $2) data`,
        [fixture.main, key],
      ),
    );
    expect(second.rows[0]!.data.event_id).toBe(first.rows[0]!.data.event_id);
    const readable = await asUser(
      acting,
      users.inventory,
      async (client) =>
        (
          await client.query(`select reference from public.calendar_events where id=$1`, [
            first.rows[0]!.data.event_id,
          ])
        ).rows,
    );
    expect(readable).toHaveLength(1);
    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(
          `select public.create_calendar_event('P8 Forged', null, null, 'operation', $1, now()+interval '1 day', now()+interval '2 days', $2)`,
          [fixture.main, crypto.randomUUID()],
        ),
      ),
    ).rejects.toThrow(/calendar\.manage required/i);
  });

  it("completes a zero-stock popup summary without changing ledger or balances", async () => {
    const created = await runAsUserAndCommit(users.manager, (client) =>
      client.query<{ data: { popup_event_id: string } }>(
        `select public.create_popup_event('P8 Popup Gate', null, 'Gate venue', now()+interval '1 day', now()+interval '2 days', $1, $2, null, $3) data`,
        [fixture.popup, fixture.main, crypto.randomUUID()],
      ),
    );
    const popupId = created.rows[0]!.data.popup_event_id;
    await runAsUserAndCommit(users.manager, (client) =>
      client.query(`select public.start_popup_event($1,$2)`, [popupId, crypto.randomUUID()]),
    );
    const before = await admin.query(
      `select (select count(*)::int from public.stock_transaction_lines where item_id=$1) ledger, (select qty_on_hand from public.inventory_balances where item_id=$1 and branch_id=$2) qty`,
      [fixture.item, fixture.main],
    );
    const lines = JSON.stringify([
      {
        item_id: fixture.item,
        unit_id: fixture.unit,
        transferred_in_qty: 0,
        remaining_qty: 0,
        returned_qty: 0,
        consumed_qty: 0,
        waste_qty: 0,
        loss_qty: 0,
        gain_qty: 0,
        ending_qty: 0,
      },
    ]);
    await runAsUserAndCommit(users.manager, (client) =>
      client.query(`select public.record_popup_event_count($1,$2::jsonb,$3)`, [
        popupId,
        lines,
        crypto.randomUUID(),
      ]),
    );
    await runAsUserAndCommit(users.manager, (client) =>
      client.query(`select public.complete_popup_event($1,$2)`, [popupId, crypto.randomUUID()]),
    );
    const after = await admin.query(
      `select (select count(*)::int from public.stock_transaction_lines where item_id=$1) ledger, (select qty_on_hand from public.inventory_balances where item_id=$1 and branch_id=$2) qty, (select status from public.popup_event_sessions where id=$3) status`,
      [fixture.item, fixture.main, popupId],
    );
    expect(after.rows[0]).toEqual({
      ledger: before.rows[0].ledger,
      qty: before.rows[0].qty,
      status: "completed",
    });
  });
});
