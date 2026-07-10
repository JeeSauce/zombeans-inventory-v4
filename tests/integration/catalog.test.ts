import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client } from "pg";
import { connect, createUser, assignRole, asUser, cleanupUsers } from "./helpers/db";

/**
 * Phase 2 catalog authorization + integrity tests against real Postgres (local Supabase).
 * Gate scenarios: 19 (branch prices independent) and 20 (VAT only when enabled), plus RLS gating
 * of catalog reads/writes, price visibility, settings lockdown, and the sensitive-cost column.
 *
 * Run with: `npm run test:integration` (requires `npx supabase start`).
 */

const EMAIL_LIKE = "cattest+%@zombeans.test";
let admin: Client;
let acting: Client;

const ids = {} as { super: string; manager: string; inventory: string };
const fx = {} as {
  itemId: string;
  productId: string;
  variantId: string;
  commissary: string;
  sanCarlos: string;
};

afterEach(async () => {
  // Prices are the only per-test rows we mutate; clear them so cases don't bleed into each other.
  if (fx.productId) {
    await admin.query(`delete from public.branch_prices where product_id = $1 or variant_id = $2`, [
      fx.productId,
      fx.variantId,
    ]);
  }
});

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupUsers(admin, EMAIL_LIKE);
  await admin.query(`delete from public.inventory_items where sku like 'CATTEST-%'`);

  ids.super = await createUser(admin, "cattest+super@zombeans.test", { fullName: "Cat Super" });
  ids.manager = await createUser(admin, "cattest+manager@zombeans.test", { fullName: "Cat Mgr" });
  ids.inventory = await createUser(admin, "cattest+inv@zombeans.test", { fullName: "Cat Inv" });
  await assignRole(admin, ids.super, "super_admin");
  await assignRole(admin, ids.manager, "branch_manager");
  await assignRole(admin, ids.inventory, "inventory");

  const branches = await admin.query(
    `select key, id from public.branches where key in ('commissary', 'san-carlos')`,
  );
  fx.commissary = branches.rows.find((r) => r.key === "commissary").id;
  fx.sanCarlos = branches.rows.find((r) => r.key === "san-carlos").id;

  const unit = await admin.query(`select id from public.units where code = 'pc'`);
  const item = await admin.query(
    `insert into public.inventory_items (name, sku, item_type, base_unit_id)
     values ('CatTest Latte', 'CATTEST-1', 'drink', $1) returning id`,
    [unit.rows[0].id],
  );
  fx.itemId = item.rows[0].id;
  const product = await admin.query(
    `insert into public.products (item_id, product_kind) values ($1, 'drink') returning id`,
    [fx.itemId],
  );
  fx.productId = product.rows[0].id;
  const variant = await admin.query(
    `insert into public.product_variants (product_id, name, sku)
     values ($1, 'Large', 'CATTEST-VAR-1') returning id`,
    [fx.productId],
  );
  fx.variantId = variant.rows[0].id;
}, 60_000);

afterAll(async () => {
  await admin.query(`delete from public.inventory_items where sku like 'CATTEST-%'`); // cascades
  await cleanupUsers(admin, EMAIL_LIKE);
  await admin.end();
  await acting.end();
});

describe("scenario 19 — branch prices are independent", () => {
  it("keeps per-branch prices independent when one changes", async () => {
    await admin.query(
      `insert into public.branch_prices (branch_id, product_id, price, tax_mode)
       values ($1, $2, 100, 'none'), ($3, $2, 150, 'none')`,
      [fx.commissary, fx.productId, fx.sanCarlos],
    );
    // Change only the commissary price.
    await admin.query(
      `update public.branch_prices set price = 120 where branch_id = $1 and product_id = $2`,
      [fx.commissary, fx.productId],
    );
    const rows = await admin.query(
      `select branch_id, price from public.branch_prices where product_id = $1`,
      [fx.productId],
    );
    const byBranch = Object.fromEntries(rows.rows.map((r) => [r.branch_id, Number(r.price)]));
    expect(byBranch[fx.commissary]).toBe(120);
    expect(byBranch[fx.sanCarlos]).toBe(150); // unchanged
  });

  it("rejects two prices for the same product in one branch", async () => {
    await admin.query(
      `insert into public.branch_prices (branch_id, product_id, price) values ($1, $2, 100)`,
      [fx.commissary, fx.productId],
    );
    await expect(
      admin.query(
        `insert into public.branch_prices (branch_id, product_id, price) values ($1, $2, 111)`,
        [fx.commissary, fx.productId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("requires exactly one price target (product XOR variant)", async () => {
    await expect(
      admin.query(`insert into public.branch_prices (branch_id, price) values ($1, 50)`, [
        fx.commissary,
      ]),
    ).rejects.toThrow(/branch_prices_one_target|check/i);
    await expect(
      admin.query(
        `insert into public.branch_prices (branch_id, product_id, variant_id, price)
         values ($1, $2, $3, 50)`,
        [fx.commissary, fx.productId, fx.variantId],
      ),
    ).rejects.toThrow(/branch_prices_one_target|check/i);
  });

  it("allows a variant price alongside its product price in the same branch", async () => {
    await admin.query(
      `insert into public.branch_prices (branch_id, product_id, price) values ($1, $2, 100)`,
      [fx.commissary, fx.productId],
    );
    await admin.query(
      `insert into public.branch_prices (branch_id, variant_id, price) values ($1, $2, 130)`,
      [fx.commissary, fx.variantId],
    );
    const n = await admin.query(
      `select count(*)::int n from public.branch_prices where branch_id = $1`,
      [fx.commissary],
    );
    expect(n.rows[0].n).toBe(2);
  });
});

describe("scenario 20 — VAT is calculated only when enabled (DB)", () => {
  it("does not tax while VAT is disabled (seed default)", async () => {
    const r = await admin.query(`select * from public.compute_line_tax(100, 'exclusive')`);
    expect(r.rows[0].applied).toBe(false);
    expect(Number(r.rows[0].tax)).toBe(0);
    expect(Number(r.rows[0].gross)).toBe(100);
  });

  it("taxes only when enabled, and never a 'none' price", async () => {
    await admin.query("begin");
    try {
      await admin.query(
        `update public.application_settings set value = jsonb_set(value, '{enabled}', 'true')
         where key = 'vat'`,
      );
      const excl = await admin.query(`select * from public.compute_line_tax(100, 'exclusive')`);
      const incl = await admin.query(`select * from public.compute_line_tax(112, 'inclusive')`);
      const none = await admin.query(`select * from public.compute_line_tax(100, 'none')`);
      expect(Number(excl.rows[0].tax)).toBe(12);
      expect(Number(excl.rows[0].gross)).toBe(112);
      expect(Number(incl.rows[0].net)).toBe(100);
      expect(none.rows[0].applied).toBe(false);
    } finally {
      await admin.query("rollback");
    }
  });
});

describe("catalog RLS gating", () => {
  it("price.read gates branch_prices visibility", async () => {
    await admin.query(
      `insert into public.branch_prices (branch_id, product_id, price) values ($1, $2, 100)`,
      [fx.commissary, fx.productId],
    );
    const mgr = await asUser(acting, ids.manager, (c) =>
      c.query(`select count(*)::int n from public.branch_prices where product_id = $1`, [
        fx.productId,
      ]),
    );
    const inv = await asUser(acting, ids.inventory, (c) =>
      c.query(`select count(*)::int n from public.branch_prices where product_id = $1`, [
        fx.productId,
      ]),
    );
    expect(mgr.rows[0].n).toBeGreaterThanOrEqual(1); // branch_manager has price.read
    expect(inv.rows[0].n).toBe(0); // inventory staff do not
  });

  it("price.write is denied without permission", async () => {
    await expect(
      asUser(acting, ids.inventory, (c) =>
        c.query(
          `insert into public.branch_prices (branch_id, product_id, price) values ($1, $2, 99)`,
          [fx.commissary, fx.productId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("application_settings are readable only with settings.manage", async () => {
    const superN = await asUser(acting, ids.super, (c) =>
      c.query(`select count(*)::int n from public.application_settings`),
    );
    const invN = await asUser(acting, ids.inventory, (c) =>
      c.query(`select count(*)::int n from public.application_settings`),
    );
    expect(superN.rows[0].n).toBeGreaterThanOrEqual(2);
    expect(invN.rows[0].n).toBe(0);
  });

  it("the sensitive weighted_avg_cost column is not readable by authenticated users", async () => {
    await expect(
      asUser(acting, ids.super, (c) =>
        c.query(`select weighted_avg_cost from public.inventory_items limit 1`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("catalog.item.read lets inventory staff read items; writes require catalog.item.write", async () => {
    const readable = await asUser(acting, ids.inventory, (c) =>
      c.query(`select count(*)::int n from public.inventory_items`),
    );
    expect(readable.rows[0].n).toBeGreaterThanOrEqual(1);

    await expect(
      asUser(acting, ids.inventory, (c) =>
        c.query(`insert into public.categories (name, item_type) values ('nope', 'drink')`),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("catalog.item.write lets the super admin create a category", async () => {
    await expect(
      asUser(acting, ids.super, (c) =>
        c.query(
          `insert into public.categories (name, item_type) values ('rls-super-cat', 'drink')`,
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("authenticated users can mint a SKU via the definer function", async () => {
    const r = await asUser(acting, ids.inventory, (c) =>
      c.query(`select public.next_item_sku() as sku`),
    );
    expect(r.rows[0].sku).toMatch(/^ITM-\d{6}$/);
  });
});
