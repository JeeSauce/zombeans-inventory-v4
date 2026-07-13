import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignRole, connect, createUser } from "./helpers/db";

const EMAIL_PATTERN = "%@production-phase5.test";
const SKU_PATTERN = "PRODTEST-%";

let admin: Client;
let acting: Client;
const users = { super: "", production: "", manager: "", inventory: "" };
const base = { unit: "", branch: "" };

async function cleanupProductionUsers(client: Client): Promise<void> {
  // These fixtures are never protected accounts, so ordinary cascades are sufficient. Avoid the
  // shared cleanupUsers trigger toggle, which could weaken an unrelated parallel RLS assertion.
  await client.query(`delete from auth.users where email like $1`, [EMAIL_PATTERN]);
}

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

async function cleanupProductionTestData(client: Client): Promise<void> {
  await client.query(`alter table public.production_orders disable trigger guard_production_order`);
  await client.query(
    `alter table public.production_order_inputs disable trigger guard_production_input`,
  );
  await client.query(`alter table public.cost_snapshots disable trigger cost_snapshots_append_only`);
  await client.query(
    `alter table public.recipe_versions disable trigger guard_activated_recipe_version`,
  );
  await client.query(`alter table public.recipe_lines disable trigger guard_activated_recipe_lines`);
  try {
    await client.query(`
      update public.production_orders set
        status = 'cancelled', production_output_txn_id = null,
        confirmed_at = null, confirmed_by = null
      where template_id in (
        select id from public.production_templates where name like 'ProdTest %'
      )`);
    await client.query(`
      delete from public.stock_transactions where production_order_id in (
        select po.id from public.production_orders po
        join public.production_templates pt on pt.id = po.template_id
        where pt.name like 'ProdTest %'
      )`);
    await client.query(`
      delete from public.production_order_inputs where production_order_id in (
        select po.id from public.production_orders po
        join public.production_templates pt on pt.id = po.template_id
        where pt.name like 'ProdTest %'
      )`);
    await client.query(`
      delete from public.production_orders where template_id in (
        select id from public.production_templates where name like 'ProdTest %'
      )`);
    await client.query(`delete from public.production_templates where name like 'ProdTest %'`);
    await client.query(`
      delete from public.inventory_lots where item_id in (
        select id from public.inventory_items where sku like $1
      )`, [SKU_PATTERN]);
    await client.query(`
      delete from public.inventory_balances where item_id in (
        select id from public.inventory_items where sku like $1
      )`, [SKU_PATTERN]);
    await client.query(`
      delete from public.cost_snapshots where recipe_version_id in (
        select rv.id from public.recipe_versions rv
        join public.recipes r on r.id = rv.recipe_id
        join public.inventory_items ii on ii.id = r.output_item_id
        where ii.sku like $1
      )`, [SKU_PATTERN]);
    await client.query(`
      delete from public.recipes where output_item_id in (
        select id from public.inventory_items where sku like $1
      )`, [SKU_PATTERN]);
    await client.query(`delete from public.inventory_items where sku like $1`, [SKU_PATTERN]);
  } finally {
    await client.query(`alter table public.production_orders enable trigger guard_production_order`);
    await client.query(
      `alter table public.production_order_inputs enable trigger guard_production_input`,
    );
    await client.query(`alter table public.cost_snapshots enable trigger cost_snapshots_append_only`);
    await client.query(
      `alter table public.recipe_versions enable trigger guard_activated_recipe_version`,
    );
    await client.query(`alter table public.recipe_lines enable trigger guard_activated_recipe_lines`);
  }
}

interface Scenario {
  tag: string;
  templateId: string;
  orderId: string;
  reference: string;
  outputItemId: string;
  inputItemIds: string[];
  idempotencyKey: string;
}

async function createScenario(tag: string, inputQtys: number[]): Promise<Scenario> {
  const inputItemIds: string[] = [];
  for (let index = 0; index < inputQtys.length; index += 1) {
    const item = await admin.query<{ id: string }>(
      `insert into public.inventory_items
         (name, sku, item_type, base_unit_id, weighted_avg_cost, created_by, updated_by)
       values ($1, $2, 'raw_ingredient', $3, $4, $5, $5) returning id`,
      [
        `ProdTest ${tag} Input ${index + 1}`,
        `PRODTEST-${tag}-IN-${index + 1}`,
        base.unit,
        10 + index,
        users.super,
      ],
    );
    inputItemIds.push(item.rows[0]!.id);
  }

  const output = await admin.query<{ id: string }>(
    `insert into public.inventory_items
       (name, sku, item_type, base_unit_id, created_by, updated_by)
     values ($1, $2, 'sub_product', $3, $4, $4) returning id`,
    [`ProdTest ${tag} Output`, `PRODTEST-${tag}-OUT`, base.unit, users.super],
  );
  const outputItemId = output.rows[0]!.id;
  const recipe = await admin.query<{ id: string }>(
    `insert into public.recipes
       (name, kind, output_item_id, created_by, updated_by)
     values ($1, 'production', $2, $3, $3) returning id`,
    [`ProdTest ${tag} Recipe`, outputItemId, users.super],
  );
  const version = await admin.query<{ id: string }>(
    `insert into public.recipe_versions
       (recipe_id, version_number, output_qty, output_unit_id,
        expected_yield_pct, expected_waste_pct, created_by, updated_by)
     values ($1, 1, 10, $2, 90, 5, $3, $3) returning id`,
    [recipe.rows[0]!.id, base.unit, users.super],
  );
  for (let index = 0; index < inputItemIds.length; index += 1) {
    await admin.query(
      `insert into public.recipe_lines
         (recipe_version_id, input_item_id, qty, created_by, updated_by)
       values ($1, $2, $3, $4, $4)`,
      [version.rows[0]!.id, inputItemIds[index], inputQtys[index], users.super],
    );
  }
  await runAsUserAndCommit(users.super, (client) =>
    client.query(`select public.activate_recipe_version($1)`, [version.rows[0]!.id]),
  );
  const template = await admin.query<{ id: string }>(
    `insert into public.production_templates
       (name, recipe_id, created_by, updated_by)
     values ($1, $2, $3, $3) returning id`,
    [`ProdTest ${tag} Template`, recipe.rows[0]!.id, users.super],
  );

  const idempotencyKey = crypto.randomUUID();
  const created = await runAsUserAndCommit(users.production, (client) =>
    client.query<{ result: { id: string; reference: string } }>(
      `select public.create_production_order($1, 1, $2, null) result`,
      [template.rows[0]!.id, idempotencyKey],
    ),
  );
  return {
    tag,
    templateId: template.rows[0]!.id,
    orderId: created.rows[0]!.result.id,
    reference: created.rows[0]!.result.reference,
    outputItemId,
    inputItemIds,
    idempotencyKey,
  };
}

async function recordScenario(
  scenario: Scenario,
  actualConsumed: number[],
  waste: number[] = actualConsumed.map(() => 0),
): Promise<void> {
  await runAsUserAndCommit(users.production, async (client) => {
    await client.query(
      `update public.production_orders set
         status = 'in_progress', started_at = now(), started_by = $2, updated_by = $2
       where id = $1`,
      [scenario.orderId, users.production],
    );
    const inputs = await client.query<{ id: string; item_id: string }>(
      `select id, item_id from public.production_order_inputs where production_order_id = $1`,
      [scenario.orderId],
    );
    await client.query(
      `select public.record_production_actuals(
         $1, 9, $2, (now() at time zone 'Asia/Manila')::date,
         (now() at time zone 'Asia/Manila')::date + 7, null, $3::jsonb
       )`,
      [
        scenario.orderId,
        `BATCH-${scenario.tag}`,
        JSON.stringify(
          inputs.rows.map((input) => {
            const index = scenario.inputItemIds.indexOf(input.item_id);
            return {
              id: input.id,
              actual_consumed_qty: actualConsumed[index],
              waste_qty: waste[index],
              notes: null,
            };
          }),
        ),
      ],
    );
  });
}

async function addLot(
  itemId: string,
  qty: number,
  expiryOffset: number | null,
  status: "available" | "expired" | "quarantined" = "available",
): Promise<string> {
  const lot = await admin.query<{ id: string }>(
    `insert into public.inventory_lots
       (item_id, branch_id, lot_number, expiration_date, qty_remaining, unit_cost, status)
     values ($1, $2, $3,
       case when $4::int is null then null
            else (now() at time zone 'Asia/Manila')::date + $4::int end,
       $5, 10, $6) returning id`,
    [itemId, base.branch, crypto.randomUUID(), expiryOffset, qty, status],
  );
  await admin.query(
    `insert into public.inventory_balances (item_id, branch_id, qty_on_hand)
     values ($1, $2, $3)
     on conflict (item_id, branch_id) do update
       set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand`,
    [itemId, base.branch, qty],
  );
  return lot.rows[0]!.id;
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupProductionTestData(admin);
  await cleanupProductionUsers(admin);

  users.super = await createUser(admin, "super@production-phase5.test");
  users.production = await createUser(admin, "staff@production-phase5.test");
  users.manager = await createUser(admin, "manager@production-phase5.test");
  users.inventory = await createUser(admin, "inventory@production-phase5.test");
  await assignRole(admin, users.super, "super_admin");
  await assignRole(admin, users.production, "production");
  await assignRole(admin, users.manager, "branch_manager");
  await assignRole(admin, users.inventory, "inventory");

  base.unit = (await admin.query(`select id from public.units where code = 'g'`)).rows[0]!.id;
  base.branch = (await admin.query(`select id from public.branches where is_main`)).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  if (admin) {
    await cleanupProductionTestData(admin);
    await cleanupProductionUsers(admin);
    await admin.end();
  }
  if (acting) await acting.end();
});

describe("Phase 5 production authorization", () => {
  it("allows production operators and confirmers to read while gating inventory staff", async () => {
    const scenario = await createScenario("RLS", [1]);
    const production = await runAsUserAndCommit(users.production, (client) =>
      client.query<{ n: number }>(
        `select count(*)::int n from public.production_orders where id = $1`,
        [scenario.orderId],
      ),
    );
    const manager = await runAsUserAndCommit(users.manager, (client) =>
      client.query<{ n: number }>(
        `select count(*)::int n from public.production_orders where id = $1`,
        [scenario.orderId],
      ),
    );
    const inventory = await runAsUserAndCommit(users.inventory, (client) =>
      client.query<{ n: number }>(
        `select count(*)::int n from public.production_orders where id = $1`,
        [scenario.orderId],
      ),
    );
    expect(production.rows[0]!.n).toBe(1);
    expect(manager.rows[0]!.n).toBe(1);
    expect(inventory.rows[0]!.n).toBe(0);
    await expect(
      runAsUserAndCommit(users.production, (client) =>
        client.query(`select public.post_production_completion($1)`, [scenario.orderId]),
      ),
    ).rejects.toThrow(/production\.confirm required/i);
  });
});

describe("critical scenario 2 — production cannot consume expired inventory", () => {
  it("uses eligible lots FEFO and skips expired or quarantined lots", async () => {
    const scenario = await createScenario("FEFO", [5]);
    const expired = await addLot(scenario.inputItemIds[0]!, 100, -1, "expired");
    const quarantined = await addLot(scenario.inputItemIds[0]!, 100, 1, "quarantined");
    const earlier = await addLot(scenario.inputItemIds[0]!, 3, 2);
    const later = await addLot(scenario.inputItemIds[0]!, 3, 10);
    await recordScenario(scenario, [5]);

    await runAsUserAndCommit(users.manager, (client) =>
      client.query(`select public.post_production_completion($1)`, [scenario.orderId]),
    );
    const lots = await admin.query<{ id: string; qty_remaining: string }>(
      `select id, qty_remaining from public.inventory_lots where id = any($1::uuid[])`,
      [[expired, quarantined, earlier, later]],
    );
    const quantities = new Map(lots.rows.map((lot) => [lot.id, Number(lot.qty_remaining)]));
    expect(quantities.get(expired)).toBe(100);
    expect(quantities.get(quarantined)).toBe(100);
    expect(quantities.get(earlier)).toBe(0);
    expect(quantities.get(later)).toBe(1);
  });

  it("refuses when only expired stock can satisfy the requirement", async () => {
    const scenario = await createScenario("EXPIRED", [5]);
    const eligible = await addLot(scenario.inputItemIds[0]!, 2, 3);
    const expired = await addLot(scenario.inputItemIds[0]!, 20, -1, "expired");
    await recordScenario(scenario, [5]);

    await expect(
      runAsUserAndCommit(users.manager, (client) =>
        client.query(`select public.post_production_completion($1)`, [scenario.orderId]),
      ),
    ).rejects.toThrow(/insufficient unexpired available stock/i);

    const after = await admin.query<{ id: string; qty_remaining: string }>(
      `select id, qty_remaining from public.inventory_lots where id = any($1::uuid[])`,
      [[eligible, expired]],
    );
    expect(after.rows.map((lot) => Number(lot.qty_remaining)).sort((a, b) => a - b)).toEqual([
      2, 20,
    ]);
  });
});

describe("critical scenario 3 — production completion is atomic", () => {
  it("rolls back all lots, balances, ledger rows, and order status when any input is short", async () => {
    const scenario = await createScenario("ATOMIC", [4, 4]);
    const firstLot = await addLot(scenario.inputItemIds[0]!, 4, 4);
    const secondLot = await addLot(scenario.inputItemIds[1]!, 1, 4);
    await recordScenario(scenario, [4, 4]);
    const beforeBalances = await admin.query<{ item_id: string; qty_on_hand: string }>(
      `select item_id, qty_on_hand from public.inventory_balances
       where item_id = any($1::uuid[]) order by item_id`,
      [scenario.inputItemIds],
    );

    await expect(
      runAsUserAndCommit(users.manager, (client) =>
        client.query(`select public.post_production_completion($1)`, [scenario.orderId]),
      ),
    ).rejects.toThrow(/insufficient unexpired available stock/i);

    const lots = await admin.query<{ id: string; qty_remaining: string }>(
      `select id, qty_remaining from public.inventory_lots where id = any($1::uuid[]) order by id`,
      [[firstLot, secondLot]],
    );
    expect(lots.rows.map((lot) => Number(lot.qty_remaining)).sort((a, b) => a - b)).toEqual([1, 4]);
    const afterBalances = await admin.query<{ item_id: string; qty_on_hand: string }>(
      `select item_id, qty_on_hand from public.inventory_balances
       where item_id = any($1::uuid[]) order by item_id`,
      [scenario.inputItemIds],
    );
    expect(afterBalances.rows).toEqual(beforeBalances.rows);
    const ledger = await admin.query<{ n: number }>(
      `select count(*)::int n from public.stock_transactions where production_order_id = $1`,
      [scenario.orderId],
    );
    expect(ledger.rows[0]!.n).toBe(0);
    const order = await admin.query<{ status: string; production_output_txn_id: string | null }>(
      `select status, production_output_txn_id from public.production_orders where id = $1`,
      [scenario.orderId],
    );
    expect(order.rows[0]).toEqual({
      status: "awaiting_confirmation",
      production_output_txn_id: null,
    });
  });
});

describe("critical scenario 4 — duplicate completion is idempotent", () => {
  it("returns the existing output transaction without deducting or adding twice", async () => {
    const scenario = await createScenario("IDEMPOTENT", [5]);
    const inputLot = await addLot(scenario.inputItemIds[0]!, 10, 5);
    await recordScenario(scenario, [5], [1]);

    const first = await runAsUserAndCommit(users.manager, (client) =>
      client.query<{ txn_id: string }>(
        `select public.post_production_completion($1) txn_id`,
        [scenario.orderId],
      ),
    );
    const before = await admin.query<{
      input_qty: string;
      output_qty: string;
      transaction_count: number;
      line_count: number;
    }>(
      `select
         (select qty_remaining from public.inventory_lots where id = $2) input_qty,
         (select qty_on_hand from public.inventory_balances where item_id = $3 and branch_id = $4) output_qty,
         (select count(*)::int from public.stock_transactions where production_order_id = $1) transaction_count,
         (select count(*)::int from public.stock_transaction_lines stl
          join public.stock_transactions st on st.id = stl.txn_id
          where st.production_order_id = $1) line_count`,
      [scenario.orderId, inputLot, scenario.outputItemId, base.branch],
    );
    const second = await runAsUserAndCommit(users.manager, (client) =>
      client.query<{ txn_id: string }>(
        `select public.post_production_completion($1) txn_id`,
        [scenario.orderId],
      ),
    );
    const after = await admin.query(
      `select
         (select qty_remaining from public.inventory_lots where id = $2) input_qty,
         (select qty_on_hand from public.inventory_balances where item_id = $3 and branch_id = $4) output_qty,
         (select count(*)::int from public.stock_transactions where production_order_id = $1) transaction_count,
         (select count(*)::int from public.stock_transaction_lines stl
          join public.stock_transactions st on st.id = stl.txn_id
          where st.production_order_id = $1) line_count`,
      [scenario.orderId, inputLot, scenario.outputItemId, base.branch],
    );

    expect(second.rows[0]!.txn_id).toBe(first.rows[0]!.txn_id);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(before.rows[0]).toMatchObject({
      input_qty: "4.0000",
      output_qty: "9.0000",
      transaction_count: 3,
      line_count: 3,
    });
  });
});
