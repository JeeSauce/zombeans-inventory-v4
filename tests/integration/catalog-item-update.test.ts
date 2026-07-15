import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, assignRole, cleanupUsers, connect, createUser } from "./helpers/db";

const EMAIL_LIKE = "item-edit+%@zombeans.test";
let admin: Client;
let acting: Client;
const users = { super: "", inventory: "" };
let itemId = "";
let unitId = "";

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupUsers(admin, EMAIL_LIKE);
  users.super = await createUser(admin, "item-edit+super@zombeans.test");
  users.inventory = await createUser(admin, "item-edit+inv@zombeans.test");
  await assignRole(admin, users.super, "super_admin");
  await assignRole(admin, users.inventory, "inventory");
  unitId = (await admin.query<{ id: string }>(`select id from public.units limit 1`)).rows[0]!.id;
  itemId = (
    await admin.query<{ id: string }>(
      `insert into public.inventory_items (name, sku, item_type, base_unit_id, created_by, updated_by)
       values ('Edit Target', 'ITM-EDIT-1', 'raw_ingredient', $1, $2, $2) returning id`,
      [unitId, users.super],
    )
  ).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await admin.query(`delete from public.inventory_items where sku = 'ITM-EDIT-1'`);
  await cleanupUsers(admin, EMAIL_LIKE);
  await acting.end();
  await admin.end();
});

describe("inventory_items update contract", () => {
  it("lets a catalog.item.write holder update and bumps version via trigger", async () => {
    const after = await asUser(acting, users.super, async (c) => {
      const before = await c.query<{ version: number }>(
        `select version from public.inventory_items where id = $1`,
        [itemId],
      );
      const upd = await c.query<{ id: string; version: number; name: string }>(
        `update public.inventory_items set name = 'Edited', reorder_level = 42, updated_by = $2
         where id = $1 and version = $3 returning id, version, name`,
        [itemId, users.super, before.rows[0]!.version],
      );
      return upd.rows[0]!;
    });
    expect(after.name).toBe("Edited");
    expect(after.version).toBe(2);
  });

  it("guards a stale version to zero rows", async () => {
    // asUser rolls back, so exercise the whole race inside one transaction: a first edit bumps
    // version 1 -> 2, then a second edit that still carries the old version 1 must match nothing.
    const rows = await asUser(acting, users.super, async (c) => {
      await c.query(
        `update public.inventory_items set name = 'First' where id = $1 and version = 1`,
        [itemId],
      );
      const upd = await c.query(
        `update public.inventory_items set name = 'Stale' where id = $1 and version = 1 returning id`,
        [itemId],
      );
      return upd.rowCount;
    });
    expect(rows).toBe(0);
  });

  it("stops a user without catalog.item.write from changing any row", async () => {
    // RLS filters the row out for a non-writer, so the update matches 0 rows (no exception).
    const rowCount = await asUser(acting, users.inventory, async (c) => {
      const upd = await c.query(
        `update public.inventory_items set name = 'Nope' where id = $1 returning id`,
        [itemId],
      );
      return upd.rowCount;
    });
    expect(rowCount).toBe(0);
  });
});
