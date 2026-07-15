import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignBranch, assignRole, connect, createUser } from "./helpers/db";

const EMAIL_PATTERN = "%@stock-phase6.test";
const SKU_PATTERN = "STOCKTEST-%";

let admin: Client;
let acting: Client;
const users = { inventory: "", manager: "", production: "" };
const base = { unit: "", main: "", satellite: "" };

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

async function cleanupStockTestData(client: Client): Promise<void> {
  const transferIds = `
    select t.id from public.transfers t where t.prepared_by in (
      select p.id from public.profiles p where p.email like '${EMAIL_PATTERN}'
    )`;
  await client.query(
    `delete from public.inventory_alerts where item_id in (
    select id from public.inventory_items where sku like $1
  )`,
    [SKU_PATTERN],
  );
  await client.query(
    `delete from public.transfer_discrepancies where transfer_id in (${transferIds})`,
  );
  await client.query(`delete from public.transfer_lot_allocations where transfer_line_id in (
    select id from public.transfer_lines where transfer_id in (${transferIds})
  )`);
  await client.query(`update public.transfers set source_txn_id = null, receive_txn_id = null
    where id in (${transferIds})`);
  await client.query(
    `delete from public.stock_transactions where transfer_id in (${transferIds})
    or id in (
      select stl.txn_id from public.stock_transaction_lines stl
      join public.inventory_items ii on ii.id = stl.item_id where ii.sku like $1
    )`,
    [SKU_PATTERN],
  );
  await client.query(`delete from public.transfer_lines where transfer_id in (${transferIds})`);
  await client.query(`delete from public.transfers where id in (${transferIds})`);
  await client.query(
    `delete from public.stock_request_lines where item_id in (
    select id from public.inventory_items where sku like $1
  )`,
    [SKU_PATTERN],
  );
  await client.query(
    `delete from public.stock_requests where requested_by in (
    select id from public.profiles where email like $1
  )`,
    [EMAIL_PATTERN],
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
  await client.query(`delete from public.inventory_items where sku like $1`, [SKU_PATTERN]);
  await client.query(`delete from public.branches where key = 'stocktest-satellite'`);
}

async function createItem(tag: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    `insert into public.inventory_items (
       name, sku, item_type, base_unit_id, trackable, batch_tracked, expiry_tracked,
       weighted_avg_cost, created_by, updated_by
     ) values ($1, $2, 'sub_product', $3, true, true, true, 12.5, $4, $4)
     returning id`,
    [`StockTest ${tag}`, `STOCKTEST-${tag}`, base.unit, users.inventory],
  );
  return result.rows[0]!.id;
}

async function addLot(
  itemId: string,
  qty: number,
  cost: number,
  expiryOffset: number,
  status: "available" | "expired" = "available",
): Promise<string> {
  const result = await admin.query<{ id: string }>(
    `insert into public.inventory_lots (
       item_id, branch_id, lot_number, expiration_date, qty_remaining, unit_cost, status
     ) values ($1, $2, $3, (now() at time zone 'Asia/Manila')::date + $4::int, $5, $6, $7)
     returning id`,
    [itemId, base.main, `LOT-${crypto.randomUUID()}`, expiryOffset, qty, cost, status],
  );
  await admin.query(
    `insert into public.inventory_balances (item_id, branch_id, qty_on_hand)
     values ($1, $2, $3)
     on conflict (item_id, branch_id) do update
       set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand`,
    [itemId, base.main, qty],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupStockTestData(admin);
  await admin.query(`delete from auth.users where email like $1`, [EMAIL_PATTERN]);

  users.inventory = await createUser(admin, "inventory@stock-phase6.test");
  users.manager = await createUser(admin, "manager@stock-phase6.test");
  users.production = await createUser(admin, "production@stock-phase6.test");
  await assignRole(admin, users.inventory, "inventory");
  await assignRole(admin, users.manager, "branch_manager");
  await assignRole(admin, users.production, "production");

  base.unit = (await admin.query(`select id from public.units where code = 'g'`)).rows[0]!.id;
  base.main = (await admin.query(`select id from public.branches where is_main`)).rows[0]!.id;
  base.satellite = (
    await admin.query<{ id: string }>(
      `insert into public.branches (key, name, created_by, updated_by)
       values ('stocktest-satellite', 'StockTest Satellite', $1, $1) returning id`,
      [users.inventory],
    )
  ).rows[0]!.id;
  for (const branchId of [base.main, base.satellite]) {
    await assignBranch(admin, users.inventory, branchId);
    await assignBranch(admin, users.production, branchId);
  }
}, 60_000);

afterAll(async () => {
  if (admin) {
    await cleanupStockTestData(admin);
    await admin.query(`delete from auth.users where email like $1`, [EMAIL_PATTERN]);
    await admin.end();
  }
  if (acting) await acting.end();
});

describe("Phase 6 stock authorization", () => {
  it("enforces posting and lifecycle permissions inside definer functions", async () => {
    const itemId = await createItem("AUTH");
    await expect(
      runAsUserAndCommit(users.production, (client) =>
        client.query(`select public.post_stock_out($1, 'Test cause', null, $2, $3::jsonb)`, [
          base.satellite,
          crypto.randomUUID(),
          JSON.stringify([{ item_id: itemId, qty: 1 }]),
        ]),
      ),
    ).rejects.toThrow(/stock\.out required/i);

    const prepared = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { id: string } }>(
        `select public.prepare_transfer($1, $2, null, null, $3, $4::jsonb) result`,
        [
          base.main,
          base.satellite,
          crypto.randomUUID(),
          JSON.stringify([{ item_id: itemId, qty: 1 }]),
        ],
      ),
    );
    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(`select public.approve_transfer($1)`, [prepared.rows[0]!.result.id]),
      ),
    ).rejects.toThrow(/stock\.transfer\.approve required/i);
    const preparedLine = await admin.query<{ id: string }>(
      `select id from public.transfer_lines where transfer_id = $1`,
      [prepared.rows[0]!.result.id],
    );
    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(`select public.receive_transfer($1, $2, null, $3::jsonb)`, [
          prepared.rows[0]!.result.id,
          crypto.randomUUID(),
          JSON.stringify([
            {
              line_id: preparedLine.rows[0]!.id,
              received_qty: 0,
              rejected_qty: 0,
              damaged_qty: 0,
              missing_qty: 0,
            },
          ]),
        ]),
      ),
    ).rejects.toThrow(/must be in transit/i);

    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(
          `insert into public.inventory_alerts
             (item_id, branch_id, qty_on_hand, cause_txn_id, reason, created_by)
           values ($1, $2, -1, gen_random_uuid(), 'forged', $3)`,
          [itemId, base.satellite, users.inventory],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      runAsUserAndCommit(users.inventory, (client) =>
        client.query(`select unit_cost_snapshot from public.transfer_lot_allocations`),
      ),
    ).rejects.toThrow(/permission denied/i);

    const hidden = await runAsUserAndCommit(users.production, (client) =>
      client.query<{ n: number }>(`select count(*)::int n from public.transfers where id = $1`, [
        prepared.rows[0]!.result.id,
      ]),
    );
    expect(hidden.rows[0]!.n).toBe(0);
  });
});

describe("Phase 6 direct stock-in", () => {
  it("creates a batch lot once and does not add the balance twice on replay", async () => {
    const itemId = await createItem("STOCKIN");
    const key = crypto.randomUUID();
    const lines = JSON.stringify([
      {
        item_id: itemId,
        qty: 7,
        lot_number: "DIRECT-IN-LOT",
        expiration_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      },
    ]);
    const first = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ txn_id: string }>(
        `select public.post_stock_in($1, 'Approved direct stock-in', null, $2, $3::jsonb) txn_id`,
        [base.satellite, key, lines],
      ),
    );
    const second = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ txn_id: string }>(
        `select public.post_stock_in($1, 'Approved direct stock-in', null, $2, $3::jsonb) txn_id`,
        [base.satellite, key, lines],
      ),
    );
    expect(second.rows[0]!.txn_id).toBe(first.rows[0]!.txn_id);
    const result = await admin.query(
      `select
         (select qty_on_hand from public.inventory_balances where item_id = $1 and branch_id = $2) qty,
         (select count(*)::int from public.inventory_lots where item_id = $1 and branch_id = $2) lots,
         (select type from public.stock_transactions where id = $3) type`,
      [itemId, base.satellite, first.rows[0]!.txn_id],
    );
    expect(result.rows[0]).toEqual({ qty: "7.0000", lots: 1, type: "batch_stock_in" });
  });
});

describe("critical scenario 10 — negative inventory remains visible and alerts", () => {
  it("records the exact negative balance, full ledger quantity, and active Critical alert", async () => {
    const itemId = await createItem("NEGATIVE");
    await admin.query(
      `insert into public.inventory_lots (
         item_id, branch_id, lot_number, expiration_date, qty_remaining, unit_cost
       ) values ($1, $2, 'NEG-LOT', (now() at time zone 'Asia/Manila')::date + 5, 2, 12.5)`,
      [itemId, base.satellite],
    );
    await admin.query(
      `insert into public.inventory_balances (item_id, branch_id, qty_on_hand) values ($1, $2, 2)`,
      [itemId, base.satellite],
    );
    const key = crypto.randomUUID();
    const first = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ txn_id: string }>(
        `select public.post_stock_out($1, 'Emergency operational use', null, $2, $3::jsonb) txn_id`,
        [base.satellite, key, JSON.stringify([{ item_id: itemId, qty: 5 }])],
      ),
    );
    const second = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ txn_id: string }>(
        `select public.post_stock_out($1, 'Emergency operational use', null, $2, $3::jsonb) txn_id`,
        [base.satellite, key, JSON.stringify([{ item_id: itemId, qty: 5 }])],
      ),
    );
    expect(second.rows[0]!.txn_id).toBe(first.rows[0]!.txn_id);

    const projection = await admin.query<{
      qty_on_hand: string;
      ledger_qty: string;
      alert_count: number;
      severity: string;
      status: string;
      alert_qty: string;
    }>(
      `select
         (select qty_on_hand from public.inventory_balances where item_id = $1 and branch_id = $2) qty_on_hand,
         (select sum(qty) from public.stock_transaction_lines where txn_id = $3) ledger_qty,
         (select count(*)::int from public.inventory_alerts where cause_txn_id = $3) alert_count,
         (select severity from public.inventory_alerts where cause_txn_id = $3) severity,
         (select status from public.inventory_alerts where cause_txn_id = $3) status,
         (select qty_on_hand from public.inventory_alerts where cause_txn_id = $3) alert_qty`,
      [itemId, base.satellite, first.rows[0]!.txn_id],
    );
    expect(projection.rows[0]).toEqual({
      qty_on_hand: "-3.0000",
      ledger_qty: "-5.0000",
      alert_count: 1,
      severity: "critical",
      status: "active",
      alert_qty: "-3.0000",
    });

    const visible = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ qty_on_hand: string; severity: string }>(
        `select qty_on_hand, severity from public.inventory_alerts
         where item_id = $1 and branch_id = $2 and status = 'active'`,
        [itemId, base.satellite],
      ),
    );
    expect(visible.rows).toEqual([{ qty_on_hand: "-3.0000", severity: "critical" }]);
  });
});

describe("critical scenario 5 — transfer receiving is idempotent", () => {
  it("uses FEFO, preserves costs, records discrepancies, and cannot receive twice", async () => {
    const itemId = await createItem("TRANSFER");
    const expired = await addLot(itemId, 100, 1, -1, "expired");
    const earlier = await addLot(itemId, 3, 10, 2);
    const later = await addLot(itemId, 5, 20, 10);

    const prepared = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { id: string } }>(
        `select public.prepare_transfer($1, $2, null, 'Phase 6 transfer', $3, $4::jsonb) result`,
        [
          base.main,
          base.satellite,
          crypto.randomUUID(),
          JSON.stringify([{ item_id: itemId, qty: 6 }]),
        ],
      ),
    );
    const transferId = prepared.rows[0]!.result.id;
    await runAsUserAndCommit(users.manager, (client) =>
      client.query(`select public.approve_transfer($1)`, [transferId]),
    );
    const transferLine = await admin.query<{ id: string }>(
      `select id from public.transfer_lines where transfer_id = $1`,
      [transferId],
    );
    const receiveKey = crypto.randomUUID();
    const receivingLines = JSON.stringify([
      {
        line_id: transferLine.rows[0]!.id,
        received_qty: 5,
        rejected_qty: 0,
        damaged_qty: 0,
        missing_qty: 1,
      },
    ]);
    const first = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ txn_id: string }>(
        `select public.receive_transfer($1, $2, 'One unit missing in transit', $3::jsonb) txn_id`,
        [transferId, receiveKey, receivingLines],
      ),
    );
    const before = await admin.query(
      `select
         (select qty_on_hand from public.inventory_balances where item_id = $1 and branch_id = $2) dest_qty,
         (select count(*)::int from public.inventory_lots where item_id = $1 and branch_id = $2) dest_lots,
         (select count(*)::int from public.stock_transaction_lines where txn_id = $3) dest_lines,
         (select count(*)::int from public.transfer_discrepancies where transfer_id = $4) discrepancies`,
      [itemId, base.satellite, first.rows[0]!.txn_id, transferId],
    );
    const second = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ txn_id: string }>(
        `select public.receive_transfer($1, $2, 'One unit missing in transit', $3::jsonb) txn_id`,
        [transferId, receiveKey, receivingLines],
      ),
    );
    const after = await admin.query(
      `select
         (select qty_on_hand from public.inventory_balances where item_id = $1 and branch_id = $2) dest_qty,
         (select count(*)::int from public.inventory_lots where item_id = $1 and branch_id = $2) dest_lots,
         (select count(*)::int from public.stock_transaction_lines where txn_id = $3) dest_lines,
         (select count(*)::int from public.transfer_discrepancies where transfer_id = $4) discrepancies`,
      [itemId, base.satellite, first.rows[0]!.txn_id, transferId],
    );
    expect(second.rows[0]!.txn_id).toBe(first.rows[0]!.txn_id);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(before.rows[0]).toEqual({
      dest_qty: "5.0000",
      dest_lots: 2,
      dest_lines: 2,
      discrepancies: 1,
    });

    const lots = await admin.query<{ id: string; qty_remaining: string }>(
      `select id, qty_remaining from public.inventory_lots where id = any($1::uuid[])`,
      [[expired, earlier, later]],
    );
    const sourceQty = new Map(lots.rows.map((lot) => [lot.id, Number(lot.qty_remaining)]));
    expect(sourceQty.get(expired)).toBe(100);
    expect(sourceQty.get(earlier)).toBe(0);
    expect(sourceQty.get(later)).toBe(2);

    const destinationCosts = await admin.query<{ unit_cost: string; qty_remaining: string }>(
      `select unit_cost, qty_remaining from public.inventory_lots
       where item_id = $1 and branch_id = $2 order by unit_cost`,
      [itemId, base.satellite],
    );
    expect(destinationCosts.rows).toEqual([
      { unit_cost: "10.0000", qty_remaining: "3.0000" },
      { unit_cost: "20.0000", qty_remaining: "2.0000" },
    ]);
    const correlations = await admin.query<{ source: string; destination: string }>(
      `select
         (select correlation_id from public.stock_transactions where id = t.source_txn_id) source,
         (select correlation_id from public.stock_transactions where id = t.receive_txn_id) destination
       from public.transfers t where id = $1`,
      [transferId],
    );
    expect(correlations.rows[0]!.destination).toBe(correlations.rows[0]!.source);
  });
});

describe("Phase 6 stock requests", () => {
  it("reviews approved quantities and prepares the matching Main transfer", async () => {
    const itemId = await createItem("REQUEST");
    const request = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { id: string } }>(
        `select public.create_stock_request($1, 'Restock prepared mix', $2, $3::jsonb) result`,
        [base.satellite, crypto.randomUUID(), JSON.stringify([{ item_id: itemId, qty: 4 }])],
      ),
    );
    const requestId = request.rows[0]!.result.id;
    const line = await admin.query<{ id: string }>(
      `select id from public.stock_request_lines where request_id = $1`,
      [requestId],
    );
    await runAsUserAndCommit(users.manager, (client) =>
      client.query(`select public.review_stock_request($1, 'approve', 'Approved', $2::jsonb)`, [
        requestId,
        JSON.stringify([{ line_id: line.rows[0]!.id, approved_qty: 4 }]),
      ]),
    );
    const transfer = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ result: { id: string } }>(
        `select public.prepare_transfer($1, $2, $3, null, $4, $5::jsonb) result`,
        [
          base.main,
          base.satellite,
          requestId,
          crypto.randomUUID(),
          JSON.stringify([{ item_id: itemId, qty: 4 }]),
        ],
      ),
    );
    const state = await admin.query<{ request_status: string; transfer_status: string }>(
      `select sr.status request_status, t.status transfer_status
       from public.stock_requests sr join public.transfers t on t.stock_request_id = sr.id
       where t.id = $1`,
      [transfer.rows[0]!.result.id],
    );
    expect(state.rows[0]).toEqual({ request_status: "approved", transfer_status: "prepared" });
  });
});
