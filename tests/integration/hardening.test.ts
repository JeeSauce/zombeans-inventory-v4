import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asUser, assignRole, cleanupUsers, connect, createUser } from "./helpers/db";

const EMAIL_LIKE = "phase11-hardening+%@zombeans.test";

let admin: Client;
let acting: Client;
const users = {} as Record<"super" | "manager" | "production" | "inventory", string>;

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupUsers(admin, EMAIL_LIKE);

  users.super = await createUser(admin, "phase11-hardening+super@zombeans.test");
  users.manager = await createUser(admin, "phase11-hardening+manager@zombeans.test");
  users.production = await createUser(admin, "phase11-hardening+production@zombeans.test");
  users.inventory = await createUser(admin, "phase11-hardening+inventory@zombeans.test");
  await assignRole(admin, users.super, "super_admin");
  await assignRole(admin, users.manager, "branch_manager");
  await assignRole(admin, users.production, "production");
  await assignRole(admin, users.inventory, "inventory");
}, 60_000);

afterAll(async () => {
  await cleanupUsers(admin, EMAIL_LIKE);
  await acting.end();
  await admin.end();
});

describe("Phase 11 database security contract", () => {
  it("keeps RLS enabled on every public business table", async () => {
    const result = await admin.query<{ table_name: string }>(
      `select c.relname table_name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
       order by c.relname`,
    );
    expect(result.rows).toEqual([]);
  });

  it("pins every SECURITY DEFINER search path and exposes none to PUBLIC or anon", async () => {
    const result = await admin.query<{
      function_name: string;
      search_path_pinned: boolean;
      public_execute: boolean;
      anon_execute: boolean;
    }>(
      `select p.oid::regprocedure::text function_name,
         exists (
           select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
           where setting like 'search_path=%'
         ) search_path_pinned,
         exists (
           select 1
           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
           where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
         ) public_execute,
         has_function_privilege('anon', p.oid, 'EXECUTE') anon_execute
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
       order by 1`,
    );

    expect(result.rows.length).toBeGreaterThan(80);
    expect(result.rows.filter((row) => !row.search_path_pinned)).toEqual([]);
    expect(result.rows.filter((row) => row.public_execute)).toEqual([]);
    expect(result.rows.filter((row) => row.anon_execute)).toEqual([]);
  });

  it("pins search_path on the invoker-rights trigger functions (0038)", async () => {
    const result = await admin.query<{
      function_name: string;
      search_path_pinned: boolean;
    }>(
      `select p.proname function_name,
         exists (
           select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
           where setting like 'search_path=%'
         ) search_path_pinned
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and not p.prosecdef
         and p.proname in (
           'tg_set_updated_at',
           'tg_set_updated_at_only',
           'tg_protect_super_admin',
           'tg_protect_super_admin_role'
         )
       order by 1`,
    );

    expect(result.rows).toHaveLength(4);
    expect(result.rows.filter((row) => !row.search_path_pinned)).toEqual([]);
  });

  it("binds identity probes to the JWT actor", async () => {
    const own = await asUser(acting, users.super, async (client) => {
      const result = await client.query<{ admin: boolean; branch: boolean; cost: boolean }>(
        `select public.is_super_admin($1) admin,
                public.has_branch_access($1, $2) branch,
                public.has_permission($1, 'cost.read') cost`,
        [users.super, crypto.randomUUID()],
      );
      return result.rows[0]!;
    });
    expect(own).toEqual({ admin: true, branch: true, cost: true });

    const crossUser = await asUser(acting, users.manager, async (client) => {
      const result = await client.query<{ admin: boolean; branch: boolean; cost: boolean }>(
        `select public.is_super_admin($1) admin,
                public.has_branch_access($1, $2) branch,
                public.has_permission($1, 'cost.read') cost`,
        [users.super, crypto.randomUUID()],
      );
      return result.rows[0]!;
    });
    expect(crossUser).toEqual({ admin: false, branch: false, cost: false });
  });

  it("fails closed for unassigned operational staff while preserving manager/global scope", async () => {
    const branchId = crypto.randomUUID();
    const production = await asUser(acting, users.production, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        `select public.has_branch_access($1, $2) allowed`,
        [users.production, branchId],
      );
      return result.rows[0]!.allowed;
    });
    const inventory = await asUser(acting, users.inventory, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        `select public.has_branch_access($1, $2) allowed`,
        [users.inventory, branchId],
      );
      return result.rows[0]!.allowed;
    });
    const manager = await asUser(acting, users.manager, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        `select public.has_branch_access($1, $2) allowed`,
        [users.manager, branchId],
      );
      return result.rows[0]!.allowed;
    });

    expect({ production, inventory, manager }).toEqual({
      production: false,
      inventory: false,
      manager: true,
    });
  });

  it("permission-checks browser-callable reference generators", async () => {
    const po = await asUser(acting, users.manager, (client) =>
      client.query<{ reference: string }>(`select public.next_po_reference() reference`),
    );
    expect(po.rows[0]!.reference).toMatch(/^PO-\d{4}-\d{6}$/);

    await expect(
      asUser(acting, users.manager, (client) => client.query(`select public.next_item_sku()`)),
    ).rejects.toThrow(/catalog\.item\.write required/i);

    const receipt = await asUser(acting, users.inventory, (client) =>
      client.query<{ reference: string }>(`select public.next_receipt_reference() reference`),
    );
    expect(receipt.rows[0]!.reference).toMatch(/^RCV-\d{4}-\d{6}$/);

    await expect(
      asUser(acting, users.production, (client) =>
        client.query(`select public.next_return_reference()`),
      ),
    ).rejects.toThrow(/purchase\.receive required/i);
  });

  it("keeps internal reference generators inaccessible to authenticated clients", async () => {
    const internalFunctions = [
      "next_variant_sku()",
      "next_stock_txn_reference()",
      "next_production_reference()",
      "next_stock_request_reference()",
      "next_transfer_reference()",
      "next_recount_reference()",
      "next_recount_adjustment_reference()",
      "next_day_close_reference()",
      "next_day_close_event_reference()",
      "next_notification_reference()",
      "next_calendar_event_reference()",
      "next_popup_event_reference()",
      "next_offline_submission_reference()",
      "next_pos_import_reference()",
    ];
    const result = await admin.query<{ function_name: string; can_execute: boolean }>(
      `select signature function_name,
              has_function_privilege('authenticated', ('public.' || signature)::regprocedure,
                'EXECUTE') can_execute
       from unnest($1::text[]) signature`,
      [internalFunctions],
    );
    expect(result.rows.filter((row) => row.can_execute)).toEqual([]);
  });

  it("keeps the cross-user notification branch predicate owner-internal", async () => {
    const result = await admin.query<{ role_name: string; can_execute: boolean }>(
      `select role_name,
              has_function_privilege(
                role_name,
                'public._branch_scope_internal(uuid,uuid)'::regprocedure,
                'EXECUTE'
              ) can_execute
       from unnest(array['authenticated', 'service_role', 'anon']) role_name
       order by role_name`,
    );
    expect(result.rows.filter((row) => row.can_execute)).toEqual([]);
  });

  it("gates batch costing at the database boundary", async () => {
    await expect(
      asUser(acting, users.manager, (client) =>
        client.query(`select public.calculate_recipe_cost_batch($1::uuid[])`, [
          [crypto.randomUUID()],
        ]),
      ),
    ).rejects.toThrow(/cost\.read required/i);

    const result = await asUser(acting, users.super, (client) =>
      client.query<{ rows: Array<{ cost: null; error: string }> }>(
        `select public.calculate_recipe_cost_batch($1::uuid[]) rows`,
        [[crypto.randomUUID()]],
      ),
    );
    expect(result.rows[0]!.rows).toHaveLength(1);
    expect(result.rows[0]!.rows[0]).toMatchObject({
      cost: null,
      error: "Recipe version not found",
    });
  });
});

describe("Phase 11 EXPLAIN-backed hot-path indexes", () => {
  const expectedIndexes = [
    "inventory_balances_branch_item_idx",
    "stock_transaction_lines_item_txn_idx",
    "stock_transactions_posted_created_idx",
    "stock_transactions_posted_business_date_idx",
    "production_orders_completed_confirmed_idx",
    "recount_sessions_report_date_idx",
  ];

  it("installs every reviewed hardening index", async () => {
    const result = await admin.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = 'public' and indexname = any($1::text[])
       order by indexname`,
      [expectedIndexes],
    );
    expect(result.rows.map((row) => row.indexname)).toEqual([...expectedIndexes].sort());
  });

  it("makes the indexes available to the ledger, balance, report, and dashboard plans", async () => {
    await admin.query("begin");
    try {
      await admin.query("set local enable_seqscan = off");
      const queries = [
        `select item_id, qty_on_hand from public.inventory_balances
         where branch_id = '00000000-0000-0000-0000-000000000001'::uuid`,
        `select txn_id, qty from public.stock_transaction_lines
         where item_id = '00000000-0000-0000-0000-000000000001'::uuid`,
        `select id from public.stock_transactions
         where status = 'posted' and created_at >= now() - interval '30 days'
         order by created_at desc, id`,
        `select id from public.stock_transactions
         where status = 'posted'
           and ((coalesce(confirmed_at, created_at) at time zone 'Asia/Manila')::date)
             between current_date - 30 and current_date
         order by ((coalesce(confirmed_at, created_at) at time zone 'Asia/Manila')::date), id`,
        `select id from public.production_orders
         where status = 'completed' and confirmed_at >= now() - interval '30 days'
         order by confirmed_at desc, branch_id`,
        `select id from public.recount_sessions
         where status in ('submitted', 'adjusted', 'closed')
           and business_date between current_date - 30 and current_date`,
      ];
      const planText: string[] = [];
      for (const query of queries) {
        const result = await admin.query(`explain (analyze, buffers, format json) ${query}`);
        planText.push(JSON.stringify(result.rows[0]!["QUERY PLAN"]));
      }
      for (const index of expectedIndexes) {
        expect(planText.join("\n")).toContain(index);
      }
    } finally {
      await admin.query("rollback");
    }
  });
});
