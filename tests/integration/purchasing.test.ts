import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { connect, createUser, assignRole, asUser, cleanupUsers } from "./helpers/db";

const EMAIL_LIKE = "purtest+%@zombeans.test";
let admin: Client, acting: Client;
const ids = {} as { super: string; inventory: string; manager: string };
const fx = {} as { itemId: string; unitKg: string; supplierId: string; siId: string; main: string };

async function newPO(orderedQty: number, unitCost: number) {
  const po = await admin.query(
    `insert into purchase_orders (reference, supplier_id, status, created_by)
     values (public.next_po_reference(), $1, 'approved', $2) returning id`,
    [fx.supplierId, ids.super],
  );
  const line = await admin.query(
    `insert into purchase_order_lines (po_id, item_id, unit_id, ordered_qty, unit_cost, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [po.rows[0].id, fx.itemId, fx.unitKg, orderedQty, unitCost, ids.super],
  );
  return { poId: po.rows[0].id as string, lineId: line.rows[0].id as string };
}
async function receive(poId: string, lineId: string, accepted: number, key: string) {
  const r = await admin.query(
    `insert into purchase_receipts (reference, po_id, received_by, idempotency_key, created_by)
     values (public.next_receipt_reference(), $1, $2, $3, $2) returning id`,
    [poId, ids.inventory, key],
  );
  await admin.query(
    `insert into purchase_receipt_lines (receipt_id, po_line_id, delivered_qty, accepted_qty)
     values ($1,$2,$3,$3)`,
    [r.rows[0].id, lineId, accepted],
  );
  return r.rows[0].id as string;
}
const avg = async () =>
  Number(
    (await admin.query(`select weighted_avg_cost c from inventory_items where id=$1`, [fx.itemId]))
      .rows[0].c,
  );
const onHand = async () =>
  Number(
    (
      await admin.query(
        `select qty_on_hand q from inventory_balances where item_id=$1 and branch_id=$2`,
        [fx.itemId, fx.main],
      )
    ).rows[0]?.q ?? 0,
  );

/**
 * PURTEST-* items/suppliers have FK-restricted dependents (purchase_order_lines, purchase_receipts,
 * inventory_lots, stock_transactions, supplier_returns, ...). A plain `delete from inventory_items`
 * violates those FKs, so tear down in dependency order. Matches by name/sku pattern (not fixture
 * ids) so it also mops up any orphaned rows left behind by a previously-interrupted run.
 */
async function cleanupPurchasingTestData(client: Client): Promise<void> {
  await client.query(`
    delete from stock_transactions
    where purchase_receipt_id in (
      select pr.id from purchase_receipts pr
      join purchase_orders po on po.id = pr.po_id
      join suppliers s on s.id = po.supplier_id
      where s.name = 'PurTest Supplier'
    )
    or supplier_return_id in (
      select id from supplier_returns
      where supplier_id in (select id from suppliers where name = 'PurTest Supplier')
    )`);
  await client.query(
    `delete from supplier_returns where supplier_id in (select id from suppliers where name = 'PurTest Supplier')`,
  );
  await client.query(`
    delete from purchase_receipts
    where po_id in (select id from purchase_orders where supplier_id in
      (select id from suppliers where name = 'PurTest Supplier'))`);
  await client.query(
    `delete from purchase_orders where supplier_id in (select id from suppliers where name = 'PurTest Supplier')`,
  );
  await client.query(
    `delete from inventory_lots where item_id in (select id from inventory_items where sku like 'PURTEST-%')`,
  );
  await client.query(
    `delete from supplier_items where supplier_id in (select id from suppliers where name = 'PurTest Supplier')`,
  );
  await client.query(`delete from suppliers where name = 'PurTest Supplier'`);
  await client.query(`delete from inventory_items where sku like 'PURTEST-%'`);
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  // Purchasing rows (created_by/received_by) reference profiles, so clear them before user cleanup.
  await cleanupPurchasingTestData(admin);
  await cleanupUsers(admin, EMAIL_LIKE);
  ids.super = await createUser(admin, "purtest+super@zombeans.test", { fullName: "P Super" });
  ids.inventory = await createUser(admin, "purtest+inv@zombeans.test", { fullName: "P Inv" });
  ids.manager = await createUser(admin, "purtest+mgr@zombeans.test", { fullName: "P Mgr" });
  await assignRole(admin, ids.super, "super_admin");
  await assignRole(admin, ids.inventory, "inventory");
  await assignRole(admin, ids.manager, "branch_manager");

  fx.main = (await admin.query(`select id from branches where is_main limit 1`)).rows[0].id;
  fx.unitKg = (await admin.query(`select id from units where code='kg'`)).rows[0].id;
  const item = await admin.query(
    `insert into inventory_items (name, sku, item_type, base_unit_id) values
     ('PurTest Beans','PURTEST-1','raw_ingredient',$1) returning id`,
    [fx.unitKg],
  );
  fx.itemId = item.rows[0].id;
  const sup = await admin.query(
    `insert into suppliers (name) values ('PurTest Supplier') returning id`,
  );
  fx.supplierId = sup.rows[0].id;
  const si = await admin.query(
    `insert into supplier_items (supplier_id, item_id) values ($1,$2) returning id`,
    [fx.supplierId, fx.itemId],
  );
  fx.siId = si.rows[0].id;
}, 60_000);

afterAll(async () => {
  await cleanupPurchasingTestData(admin);
  await cleanupUsers(admin, EMAIL_LIKE);
  await admin.end();
  await acting.end();
});

describe("scenario 6 — partial delivery posts only accepted quantities", () => {
  it("posts accepted qty, leaves PO partially_received, blocks over-receipt", async () => {
    const { poId, lineId } = await newPO(100, 40);
    const r1 = await receive(poId, lineId, 60, `p6-a-${poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [r1]);
    expect(await onHand()).toBe(60);
    let po = await admin.query(`select status from purchase_orders where id=$1`, [poId]);
    expect(po.rows[0].status).toBe("partially_received");

    // Over-receipt: outstanding is 40, try 50 → raises.
    const rOver = await receive(poId, lineId, 50, `p6-over-${poId}`);
    await expect(admin.query(`select public.post_purchase_receipt($1)`, [rOver])).rejects.toThrow(
      /over-receipt/i,
    );

    // Receive the remaining 40 → fully_received.
    const r2 = await receive(poId, lineId, 40, `p6-b-${poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [r2]);
    po = await admin.query(`select status from purchase_orders where id=$1`, [poId]);
    expect(po.rows[0].status).toBe("fully_received");
  });
});

describe("scenario 7 — weighted-average updates correctly", () => {
  it("blends costs across receipts and is idempotent", async () => {
    await admin.query(`update inventory_items set weighted_avg_cost=0 where id=$1`, [fx.itemId]);
    await admin.query(`delete from inventory_balances where item_id=$1`, [fx.itemId]);

    const a = await newPO(100, 40);
    const ra = await receive(a.poId, a.lineId, 100, `p7-a-${a.poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [ra]);
    expect(await avg()).toBe(40);

    const b = await newPO(100, 50);
    const rb = await receive(b.poId, b.lineId, 100, `p7-b-${b.poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [rb]);
    expect(await avg()).toBe(45); // (100*40 + 100*50)/200

    // Idempotent re-post: no double-count.
    const before = await onHand();
    await admin.query(`select public.post_purchase_receipt($1)`, [rb]);
    expect(await onHand()).toBe(before);
    expect(await avg()).toBe(45);
  });
});

describe("cost columns are gated from non-Super users", () => {
  it("inventory staff cannot read unit_cost on PO lines", async () => {
    await expect(
      asUser(acting, ids.inventory, (c) =>
        c.query(`select unit_cost from purchase_order_lines limit 1`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
  it("inventory staff cannot read lot unit_cost", async () => {
    await expect(
      asUser(acting, ids.inventory, (c) => c.query(`select unit_cost from inventory_lots limit 1`)),
    ).rejects.toThrow(/permission denied/i);
  });
  it("supplier_price.write is denied to a manager", async () => {
    await expect(
      asUser(acting, ids.manager, (c) =>
        c.query(`insert into supplier_prices (supplier_item_id, price) values ($1, 9)`, [fx.siId]),
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });
});

describe("supplier return reduces the right lot", () => {
  it("removes qty at the lot cost and leaves weighted-average unchanged", async () => {
    const po = await newPO(10, 40);
    const rc = await receive(po.poId, po.lineId, 10, `ret-seed-${po.poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [rc]);
    const lot = await admin.query(
      `select id, qty_remaining from inventory_lots where item_id=$1 order by created_at desc limit 1`,
      [fx.itemId],
    );
    const avgBefore = await avg();
    const ret = await admin.query(
      `insert into supplier_returns (reference, supplier_id, idempotency_key, created_by)
       values (public.next_return_reference(), $1, $2, $3) returning id`,
      [fx.supplierId, `ret-${po.poId}`, ids.super],
    );
    await admin.query(
      `insert into supplier_return_lines (return_id, item_id, lot_id, qty) values ($1,$2,$3,$4)`,
      [ret.rows[0].id, fx.itemId, lot.rows[0].id, 4],
    );
    await admin.query(`select public.post_supplier_return($1)`, [ret.rows[0].id]);
    const after = await admin.query(`select qty_remaining from inventory_lots where id=$1`, [
      lot.rows[0].id,
    ]);
    expect(Number(after.rows[0].qty_remaining)).toBe(Number(lot.rows[0].qty_remaining) - 4);
    expect(await avg()).toBe(avgBefore); // removal doesn't change weighted-average
  });
});
