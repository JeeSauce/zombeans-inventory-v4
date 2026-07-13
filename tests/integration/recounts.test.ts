import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignRole, connect, createUser } from "./helpers/db";

const EMAIL_PATTERN = "%@recounts-phase7.test";
const SKU_PATTERN = "RECOUNTTEST-%";

let admin: Client;
let acting: Client;
const users = { inventory: "", manager: "", super: "", production: "" };
const base = { unit: "", branch: "", main: "", today: "" };
const items = { ordinary: "", unusual: "" };
const seedTxnIds: string[] = [];
let closureId = "";
let reopenEventId = "";

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

async function cleanupRecountData(client: Client): Promise<void> {
  await client.query(
    `alter table public.day_close_events disable trigger day_close_events_append_only`,
  );
  try {
    const auditIds = await client.query<{ audit_log_id: string }>(
      `select e.audit_log_id
       from public.day_close_events e
       join public.daily_operational_closures dc on dc.id = e.closure_id
       join public.branches b on b.id = dc.branch_id
       where b.key = 'recounttest-branch'`,
    );
    await client.query(
      `update public.daily_operational_closures set latest_event_id = null
       where branch_id in (select id from public.branches where key = 'recounttest-branch')`,
    );
    await client.query(
      `delete from public.variance_adjustments where session_id in (
         select rs.id from public.recount_sessions rs
         join public.branches b on b.id = rs.branch_id where b.key = 'recounttest-branch'
       )`,
    );
    await client.query(
      `delete from public.recount_lines where session_id in (
         select rs.id from public.recount_sessions rs
         join public.branches b on b.id = rs.branch_id where b.key = 'recounttest-branch'
       )`,
    );
    await client.query(
      `delete from public.recount_sessions where branch_id in (
         select id from public.branches where key = 'recounttest-branch'
       )`,
    );
    await client.query(
      `delete from public.inventory_alerts where item_id in (
         select id from public.inventory_items where sku like $1
       )`,
      [SKU_PATTERN],
    );
    await client.query(
      `delete from public.stock_transactions where id in (
         select distinct stl.txn_id from public.stock_transaction_lines stl
         join public.inventory_items ii on ii.id = stl.item_id where ii.sku like $1
       )`,
      [SKU_PATTERN],
    );
    await client.query(
      `delete from public.inventory_lots where item_id in (
         select id from public.inventory_items where sku like $1
       )`,
      [SKU_PATTERN],
    );
    await client.query(
      `delete from public.inventory_balances where item_id in (
         select id from public.inventory_items where sku like $1
       )`,
      [SKU_PATTERN],
    );
    await client.query(
      `delete from public.day_close_events where closure_id in (
         select dc.id from public.daily_operational_closures dc
         join public.branches b on b.id = dc.branch_id where b.key = 'recounttest-branch'
       )`,
    );
    await client.query(
      `delete from public.daily_operational_closures where branch_id in (
         select id from public.branches where key = 'recounttest-branch'
       )`,
    );
    if (auditIds.rows.length > 0) {
      await client.query(`delete from public.audit_logs where id = any($1::uuid[])`, [
        auditIds.rows.map((row) => row.audit_log_id),
      ]);
    }
    await client.query(`delete from public.inventory_items where sku like $1`, [SKU_PATTERN]);
    await client.query(`delete from public.branches where key = 'recounttest-branch'`);
  } finally {
    await client.query(
      `alter table public.day_close_events enable trigger day_close_events_append_only`,
    );
  }
}

async function createItem(tag: string, cost: number): Promise<string> {
  const result = await admin.query<{ id: string }>(
    `insert into public.inventory_items (
       name, sku, item_type, base_unit_id, trackable, weighted_avg_cost, created_by, updated_by
     ) values ($1, $2, 'sub_product', $3, true, $4, $5, $5) returning id`,
    [`RecountTest ${tag}`, `RECOUNTTEST-${tag}`, base.unit, cost, users.super],
  );
  return result.rows[0]!.id;
}

async function seedMovement(
  itemId: string,
  type: string,
  qty: number,
  cost: number,
  fractionOfToday: number | null,
): Promise<string> {
  const branchColumns =
    qty >= 0
      ? { source: null, destination: base.branch }
      : { source: base.branch, destination: type === "transfer" ? base.main : null };
  const createdAt =
    fractionOfToday === null
      ? `((($5::date - 1) + time '12:00') at time zone 'Asia/Manila')
         + ($6::double precision * interval '0 seconds')`
      : `($5::date::timestamp at time zone 'Asia/Manila')
         + ((now() - ($5::date::timestamp at time zone 'Asia/Manila')) * $6::double precision)`;
  const params: unknown[] = [
    `TEST-${crypto.randomUUID()}`,
    type,
    branchColumns.source,
    branchColumns.destination,
    base.today,
    fractionOfToday ?? 0,
    users.super,
    crypto.randomUUID(),
  ];
  const transaction = await admin.query<{ id: string }>(
    `insert into public.stock_transactions (
       reference, type, status, source_branch_id, dest_branch_id, reason,
       created_by, confirmed_at, idempotency_key, correlation_id, created_at
     ) values (
       $1, $2::public.stock_txn_type, 'posted', $3, $4, 'Phase 7 fixture',
       $7, ${createdAt}, $8, gen_random_uuid(), ${createdAt}
     ) returning id`,
    params,
  );
  const id = transaction.rows[0]!.id;
  await admin.query(
    `insert into public.stock_transaction_lines
       (txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot, created_at)
     select $1, $2, $3, $4, null, $5, st.created_at
     from public.stock_transactions st where st.id = $1`,
    [id, itemId, qty, base.unit, cost],
  );
  seedTxnIds.push(id);
  return id;
}

async function openRecount(
  userId: string,
  type: "start_of_day" | "cycle",
  itemIds: string[] = [],
  key = crypto.randomUUID(),
): Promise<{ id: string; reference: string; already_exists: boolean }> {
  const result = await runAsUserAndCommit(userId, (client) =>
    client.query<{ result: { id: string; reference: string; already_exists: boolean } }>(
      `select public.open_recount($1, $2, $3::public.recount_session_type, $4, $5::jsonb) result`,
      [base.branch, base.today, type, key, JSON.stringify(itemIds)],
    ),
  );
  return result.rows[0]!.result;
}

async function submissionLines(
  sessionId: string,
  physicalOverride: Map<string, number>,
): Promise<Array<{ line_id: string; physical_qty: number }>> {
  const lines = await admin.query<{ id: string; item_id: string; expected_qty: string }>(
    `select id, item_id, expected_qty from public.recount_lines
     where session_id = $1 order by id`,
    [sessionId],
  );
  return lines.rows.map((line) => ({
    line_id: line.id,
    physical_qty: physicalOverride.get(line.item_id) ?? Number(line.expected_qty),
  }));
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupRecountData(admin);
  await admin.query(`delete from auth.users where email like $1`, [EMAIL_PATTERN]);

  users.inventory = await createUser(admin, "inventory@recounts-phase7.test");
  users.manager = await createUser(admin, "manager@recounts-phase7.test");
  users.super = await createUser(admin, "super@recounts-phase7.test");
  users.production = await createUser(admin, "production@recounts-phase7.test");
  await assignRole(admin, users.inventory, "inventory");
  await assignRole(admin, users.manager, "branch_manager");
  await assignRole(admin, users.super, "super_admin");
  await assignRole(admin, users.production, "production");

  base.unit = (await admin.query(`select id from public.units where code = 'g'`)).rows[0]!.id;
  base.main = (await admin.query(`select id from public.branches where is_main`)).rows[0]!.id;
  base.today = (
    await admin.query<{ business_date: string }>(
      `select (now() at time zone 'Asia/Manila')::date::text business_date`,
    )
  ).rows[0]!.business_date;
  base.branch = (
    await admin.query<{ id: string }>(
      `insert into public.branches (key, name, created_by, updated_by)
       values ('recounttest-branch', 'RecountTest Branch', $1, $1) returning id`,
      [users.super],
    )
  ).rows[0]!.id;

  items.ordinary = await createItem("ORDINARY", 20);
  items.unusual = await createItem("UNUSUAL", 10);

  await seedMovement(items.ordinary, "stock_in", 100, 20, null);
  await seedMovement(items.ordinary, "stock_in", 25.1255, 20, 0.1);
  await seedMovement(items.ordinary, "production_output", 10, 20, 0.2);
  await seedMovement(items.ordinary, "transfer", -8, 20, 0.3);
  await seedMovement(items.ordinary, "production_consumption", -20.25, 20, 0.4);
  await seedMovement(items.ordinary, "stock_out", -3, 20, 0.5);
  await seedMovement(items.ordinary, "waste", -1.5, 20, 0.6);
  await seedMovement(items.unusual, "stock_in", 10, 10, 0.7);

  await admin.query(
    `insert into public.inventory_balances (item_id, branch_id, qty_on_hand)
     values ($1, $3, 102.3755), ($2, $3, 10)`,
    [items.ordinary, items.unusual, base.branch],
  );
  await admin.query(
    `insert into public.inventory_lots
       (item_id, branch_id, lot_number, received_date, qty_remaining, unit_cost, status)
     values
       ($1, $3, 'RCT-ORDINARY', $4, 102.3755, 20, 'available'),
       ($2, $3, 'RCT-UNUSUAL', $4, 10, 10, 'available')`,
    [items.ordinary, items.unusual, base.branch, base.today],
  );
}, 60_000);

afterAll(async () => {
  if (admin) {
    await cleanupRecountData(admin);
    await admin.query(`delete from auth.users where email like $1`, [EMAIL_PATTERN]);
    await admin.end();
  }
  if (acting) await acting.end();
});

describe.sequential("Phase 7 recounts and daily operations", () => {
  it("scenario 11: snapshots the formula and posts one exact compensating adjustment", async () => {
    await expect(openRecount(users.production, "cycle", [items.ordinary])).rejects.toThrow(
      /recount\.perform required/i,
    );

    const openKey = crypto.randomUUID();
    const opened = await openRecount(users.inventory, "start_of_day", [], openKey);
    const replayedOpen = await openRecount(users.inventory, "start_of_day", [], openKey);
    expect(replayedOpen.id).toBe(opened.id);
    expect(replayedOpen.already_exists).toBe(true);
    await expect(openRecount(users.inventory, "start_of_day")).rejects.toThrow(
      /open recount of this type already exists/i,
    );

    const expected = await admin.query(
      `select opening_qty, received_qty, production_output_qty, transfers_out_qty,
              usage_qty, stock_out_qty, waste_qty, expected_qty, unit_cost_snapshot
       from public.recount_lines where session_id = $1 and item_id = $2`,
      [opened.id, items.ordinary],
    );
    expect(expected.rows[0]).toEqual({
      opening_qty: "100.0000",
      received_qty: "25.1255",
      production_output_qty: "10.0000",
      transfers_out_qty: "8.0000",
      usage_qty: "20.2500",
      stock_out_qty: "3.0000",
      waste_qty: "1.5000",
      expected_qty: "102.3755",
      unit_cost_snapshot: "20.0000",
    });

    const lines = await submissionLines(opened.id, new Map([[items.ordinary, 100.3755]]));
    const submitKey = crypto.randomUUID();
    const submitted = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { status: string; is_unusual: boolean } }>(
        `select public.submit_recount($1, $2, $3::jsonb) result`,
        [opened.id, submitKey, JSON.stringify(lines)],
      ),
    );
    expect(submitted.rows[0]!.result).toMatchObject({ status: "submitted", is_unusual: false });
    const replayedSubmit = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { already_exists: boolean } }>(
        `select public.submit_recount($1, $2, $3::jsonb) result`,
        [opened.id, submitKey, JSON.stringify(lines)],
      ),
    );
    expect(replayedSubmit.rows[0]!.result.already_exists).toBe(true);

    const postedBefore = await admin.query(
      `select jsonb_agg(to_jsonb(s) order by s.id) snapshot
       from (select * from public.stock_transactions where id = any($1::uuid[])) s`,
      [seedTxnIds],
    );
    const postedLinesBefore = await admin.query(
      `select jsonb_agg(to_jsonb(s) order by s.id) snapshot
       from (select * from public.stock_transaction_lines where txn_id = any($1::uuid[])) s`,
      [seedTxnIds],
    );
    const adjustKey = crypto.randomUUID();
    const adjusted = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { stock_txn_id: string; already_exists: boolean } }>(
        `select public.post_recount_adjustment(
           $1, 'counting_error'::public.recount_adjustment_reason, $2, $3
         ) result`,
        [opened.id, "Verified two-unit counting difference", adjustKey],
      ),
    );
    const txnId = adjusted.rows[0]!.result.stock_txn_id;
    const beforeReplay = await admin.query(
      `select
         (select qty_on_hand from public.inventory_balances where item_id = $1 and branch_id = $2) balance,
         (select count(*)::int from public.stock_transactions where idempotency_key = $3) txns,
         (select count(*)::int from public.stock_transaction_lines where txn_id = $4) lines`,
      [items.ordinary, base.branch, adjustKey, txnId],
    );
    const replayedAdjustment = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { stock_txn_id: string; already_exists: boolean } }>(
        `select public.post_recount_adjustment(
           $1, 'counting_error'::public.recount_adjustment_reason, $2, $3
         ) result`,
        [opened.id, "Verified two-unit counting difference", adjustKey],
      ),
    );
    expect(replayedAdjustment.rows[0]!.result).toMatchObject({
      stock_txn_id: txnId,
      already_exists: true,
    });
    const afterReplay = await admin.query(
      `select
         (select qty_on_hand from public.inventory_balances where item_id = $1 and branch_id = $2) balance,
         (select count(*)::int from public.stock_transactions where idempotency_key = $3) txns,
         (select count(*)::int from public.stock_transaction_lines where txn_id = $4) lines`,
      [items.ordinary, base.branch, adjustKey, txnId],
    );
    expect(afterReplay.rows[0]).toEqual(beforeReplay.rows[0]);
    expect(afterReplay.rows[0]).toMatchObject({ balance: "100.3755", txns: 1 });

    const net = await admin.query(
      `select sum(qty) qty, min(unit_cost_snapshot) min_cost, max(unit_cost_snapshot) max_cost
       from public.stock_transaction_lines where txn_id = $1`,
      [txnId],
    );
    expect(net.rows[0]).toEqual({ qty: "-2.0000", min_cost: "20.0000", max_cost: "20.0000" });
    const postedAfter = await admin.query(
      `select jsonb_agg(to_jsonb(s) order by s.id) snapshot
       from (select * from public.stock_transactions where id = any($1::uuid[])) s`,
      [seedTxnIds],
    );
    const postedLinesAfter = await admin.query(
      `select jsonb_agg(to_jsonb(s) order by s.id) snapshot
       from (select * from public.stock_transaction_lines where txn_id = any($1::uuid[])) s`,
      [seedTxnIds],
    );
    expect(postedAfter.rows[0]!.snapshot).toEqual(postedBefore.rows[0]!.snapshot);
    expect(postedLinesAfter.rows[0]!.snapshot).toEqual(postedLinesBefore.rows[0]!.snapshot);

    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(
          `select unit_cost_snapshot, variance_value_snapshot from public.recount_lines`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(`select total_variance_value from public.variance_adjustments`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("escalates an unusual cycle-count variance to Super Admin", async () => {
    const opened = await openRecount(users.inventory, "cycle", [items.unusual]);
    const lines = await submissionLines(opened.id, new Map([[items.unusual, 8.9]]));
    const submitted = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { status: string; is_unusual: boolean; unusual_signals: string[] } }>(
        `select public.submit_recount($1, $2, $3::jsonb) result`,
        [opened.id, crypto.randomUUID(), JSON.stringify(lines)],
      ),
    );
    expect(submitted.rows[0]!.result.status).toBe("submitted");
    expect(submitted.rows[0]!.result.is_unusual).toBe(true);
    expect(submitted.rows[0]!.result.unusual_signals).toContain("percent_threshold");

    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(
          `select public.post_recount_adjustment(
             $1, 'counting_error'::public.recount_adjustment_reason, $2, $3
           )`,
          [opened.id, "Verified unusual cycle difference", crypto.randomUUID()],
        ),
      ),
    ).rejects.toThrow(/recount\.confirm_unusual required/i);
    await runAsUserAndCommit(users.super, (client) =>
      client.query(
        `select public.post_recount_adjustment(
           $1, 'counting_error'::public.recount_adjustment_reason, $2, $3
         )`,
        [opened.id, "Super Admin verified unusual cycle difference", crypto.randomUUID()],
      ),
    );
    const state = await admin.query<{ status: string; is_unusual: boolean }>(
      `select status, is_unusual from public.recount_sessions where id = $1`,
      [opened.id],
    );
    expect(state.rows[0]).toEqual({ status: "adjusted", is_unusual: true });
  });

  it("scenario 12: blocks function writes and direct RLS writes after day close", async () => {
    const closeKey = crypto.randomUUID();
    const closed = await runAsUserAndCommit(users.manager, (client) =>
      client.query<{ result: { status: string; already_exists: boolean } }>(
        `select public.close_day($1, $2, $3) result`,
        [base.branch, base.today, closeKey],
      ),
    );
    expect(closed.rows[0]!.result).toMatchObject({ status: "closed", already_exists: false });
    const closeReplay = await runAsUserAndCommit(users.manager, (client) =>
      client.query<{ result: { already_exists: boolean } }>(
        `select public.close_day($1, $2, $3) result`,
        [base.branch, base.today, closeKey],
      ),
    );
    expect(closeReplay.rows[0]!.result.already_exists).toBe(true);
    closureId = (
      await admin.query<{ id: string }>(
        `select id from public.daily_operational_closures
         where branch_id = $1 and business_date = $2`,
        [base.branch, base.today],
      )
    ).rows[0]!.id;

    const before = await admin.query(
      `select
         (select qty_on_hand from public.inventory_balances where item_id = $1 and branch_id = $2) balance,
         (select count(*)::int from public.stock_transactions st
          join public.stock_transaction_lines stl on stl.txn_id = st.id
          where stl.item_id = $1) txns`,
      [items.ordinary, base.branch],
    );
    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(`select public.post_stock_in($1, $2, null, $3, $4::jsonb)`, [
          base.branch,
          "Closed-day attempt",
          crypto.randomUUID(),
          JSON.stringify([{ item_id: items.ordinary, qty: 1 }]),
        ]),
      ),
    ).rejects.toThrow(/business day .* is closed/i);
    const after = await admin.query(
      `select
         (select qty_on_hand from public.inventory_balances where item_id = $1 and branch_id = $2) balance,
         (select count(*)::int from public.stock_transactions st
          join public.stock_transaction_lines stl on stl.txn_id = st.id
          where stl.item_id = $1) txns`,
      [items.ordinary, base.branch],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(
          `insert into public.recount_sessions (
             reference, branch_id, business_date, type, open_idempotency_key, opened_by
           ) values ('FORGED-RCT', $1, $2, 'cycle', $3, $4)`,
          [base.branch, base.today, crypto.randomUUID(), users.inventory],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(
          `update public.daily_operational_closures set status = 'reopened' where id = $1`,
          [closureId],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("scenario 13: requires a Super Admin reason, audits replay once, and attributes later changes", async () => {
    await expect(
      runAsUserAndCommit(users.super, (client) =>
        client.query(`select public.reopen_day($1, $2, ' ', $3)`, [
          base.branch,
          base.today,
          crypto.randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/reopen reason is required/i);
    await expect(
      runAsUserAndCommit(users.manager, (client) =>
        client.query(`select public.reopen_day($1, $2, $3, $4)`, [
          base.branch,
          base.today,
          "Manager cannot reopen",
          crypto.randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/closure\.reopen required/i);

    const reopenKey = crypto.randomUUID();
    const reopened = await runAsUserAndCommit(users.super, (client) =>
      client.query<{ result: { event_id: string; reference: string; already_exists: boolean } }>(
        `select public.reopen_day($1, $2, $3, $4) result`,
        [base.branch, base.today, "Approved correction after manager review", reopenKey],
      ),
    );
    reopenEventId = reopened.rows[0]!.result.event_id;
    const replayed = await runAsUserAndCommit(users.super, (client) =>
      client.query<{ result: { event_id: string; already_exists: boolean } }>(
        `select public.reopen_day($1, $2, $3, $4) result`,
        [base.branch, base.today, "Approved correction after manager review", reopenKey],
      ),
    );
    expect(replayed.rows[0]!.result).toMatchObject({
      event_id: reopenEventId,
      already_exists: true,
    });

    const audit = await admin.query<{
      event_count: number;
      audit_count: number;
      reason: string;
      actor_id: string;
    }>(
      `select
         (select count(*)::int from public.day_close_events
          where closure_id = $1 and event_type = 'reopen') event_count,
         (select count(*)::int from public.audit_logs
          where entity_id = $1::text and action = 'day.reopened') audit_count,
         (select reason from public.audit_logs
          where entity_id = $1::text and action = 'day.reopened') reason,
         (select actor_id from public.audit_logs
          where entity_id = $1::text and action = 'day.reopened') actor_id`,
      [closureId],
    );
    expect(audit.rows[0]).toEqual({
      event_count: 1,
      audit_count: 1,
      reason: "Approved correction after manager review",
      actor_id: users.super,
    });

    const posted = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ txn_id: string }>(
        `select public.post_stock_in($1, $2, null, $3, $4::jsonb) txn_id`,
        [
          base.branch,
          "Post-reopen verified stock",
          crypto.randomUUID(),
          JSON.stringify([{ item_id: items.ordinary, qty: 1 }]),
        ],
      ),
    );
    const attributed = await admin.query<{ day_reopen_event_id: string; reference: string }>(
      `select day_reopen_event_id, reference from public.stock_transactions where id = $1`,
      [posted.rows[0]!.txn_id],
    );
    expect(attributed.rows[0]!.day_reopen_event_id).toBe(reopenEventId);
    expect(attributed.rows[0]!.reference).toMatch(/^STK-/);

    const visible = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ reopen_reference: string; later_reference: string }>(
        `select e.reference reopen_reference, st.reference later_reference
         from public.day_close_events e
         join public.stock_transactions st on st.day_reopen_event_id = e.id
         where e.id = $1 and st.id = $2`,
        [reopenEventId, posted.rows[0]!.txn_id],
      ),
    );
    expect(visible.rows).toHaveLength(1);
    expect(visible.rows[0]!.later_reference).toMatch(/^STK-/);
  });
});
