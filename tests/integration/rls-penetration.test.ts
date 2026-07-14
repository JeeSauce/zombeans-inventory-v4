import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, QueryResult } from "pg";
import { asUser, assignRole, cleanupUsers, connect, createUser } from "./helpers/db";

type AppRole = "super" | "manager" | "production" | "inventory";
type Verb = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
type TableContract = Record<Lowercase<Verb>, AppRole[]>;

const APP_ROLES: AppRole[] = ["super", "manager", "production", "inventory"];
const ALL: AppRole[] = [...APP_ROLES];
const SUPER: AppRole[] = ["super"];
const SUPER_MANAGER: AppRole[] = ["super", "manager"];
const SUPER_MANAGER_PRODUCTION: AppRole[] = ["super", "manager", "production"];
const SUPER_MANAGER_INVENTORY: AppRole[] = ["super", "manager", "inventory"];
const SUPER_INVENTORY: AppRole[] = ["super", "inventory"];
const SUPER_PRODUCTION: AppRole[] = ["super", "production"];
const NONE: AppRole[] = [];

const BUSINESS_TABLES = [
  "application_settings",
  "audit_logs",
  "backup_runs",
  "barcodes",
  "branch_prices",
  "branches",
  "calendar_event_commands",
  "calendar_events",
  "categories",
  "cost_snapshots",
  "daily_operational_closures",
  "day_close_events",
  "email_code_challenges",
  "inventory_alerts",
  "inventory_balances",
  "inventory_items",
  "inventory_lots",
  "loyverse_mapping_commands",
  "loyverse_mappings",
  "modifier_options",
  "modifiers",
  "notification_deliveries",
  "notification_events",
  "notification_receipts",
  "notifications",
  "offline_conflict_resolutions",
  "offline_snapshot_items",
  "offline_snapshots",
  "offline_submission_items",
  "offline_submissions",
  "permissions",
  "popup_event_commands",
  "popup_event_count_lines",
  "popup_event_movements",
  "popup_event_sessions",
  "pos_import_postings",
  "pos_import_rows",
  "pos_imports",
  "product_variants",
  "production_order_inputs",
  "production_orders",
  "production_templates",
  "products",
  "profiles",
  "purchase_order_lines",
  "purchase_orders",
  "purchase_receipt_lines",
  "purchase_receipts",
  "recipe_lines",
  "recipe_versions",
  "recipes",
  "recount_lines",
  "recount_sessions",
  "recycle_bin_commands",
  "recycle_purge_runs",
  "retention_holds",
  "role_permissions",
  "roles",
  "stock_request_lines",
  "stock_requests",
  "stock_transaction_lines",
  "stock_transactions",
  "supplier_items",
  "supplier_prices",
  "supplier_return_lines",
  "supplier_returns",
  "suppliers",
  "transfer_discrepancies",
  "transfer_lines",
  "transfer_lot_allocations",
  "transfers",
  "unit_conversions",
  "units",
  "user_branch_assignments",
  "user_roles",
  "variance_adjustments",
] as const;

const contract = new Map<string, TableContract>(
  BUSINESS_TABLES.map((table) => [table, { select: [], insert: [], update: [], delete: [] }]),
);

function allowSelect(tables: readonly string[], roles: AppRole[]) {
  for (const table of tables) contract.get(table)!.select = roles;
}

function allowDml(
  tables: readonly string[],
  verbs: Array<"insert" | "update" | "delete">,
  roles: AppRole[],
) {
  for (const table of tables) {
    for (const verb of verbs) contract.get(table)![verb] = roles;
  }
}

allowSelect(
  [
    "application_settings",
    "audit_logs",
    "backup_runs",
    "permissions",
    "recycle_bin_commands",
    "recycle_purge_runs",
    "retention_holds",
    "role_permissions",
    "roles",
    "supplier_prices",
  ],
  SUPER,
);
allowSelect(
  [
    "branch_prices",
    "loyverse_mapping_commands",
    "loyverse_mappings",
    "pos_import_postings",
    "pos_import_rows",
    "pos_imports",
    "supplier_items",
    "supplier_return_lines",
    "supplier_returns",
    "suppliers",
  ],
  SUPER_MANAGER,
);
allowSelect(
  [
    "barcodes",
    "branches",
    "calendar_events",
    "categories",
    "inventory_alerts",
    "inventory_balances",
    "inventory_items",
    "inventory_lots",
    "modifier_options",
    "modifiers",
    "notification_deliveries",
    "notification_events",
    "notification_receipts",
    "notifications",
    "offline_conflict_resolutions",
    "offline_snapshot_items",
    "offline_snapshots",
    "offline_submission_items",
    "offline_submissions",
    "popup_event_count_lines",
    "popup_event_movements",
    "popup_event_sessions",
    "product_variants",
    "products",
    "profiles",
    "stock_transaction_lines",
    "stock_transactions",
    "unit_conversions",
    "units",
    "user_branch_assignments",
    "user_roles",
  ],
  ALL,
);
allowSelect(["recipe_lines", "recipe_versions", "recipes"], SUPER_MANAGER_PRODUCTION);
allowSelect(
  ["production_order_inputs", "production_orders", "production_templates"],
  SUPER_MANAGER_PRODUCTION,
);
allowSelect(["purchase_order_lines", "purchase_orders"], SUPER_MANAGER_INVENTORY);
allowSelect(["purchase_receipt_lines", "purchase_receipts"], SUPER_INVENTORY);
allowSelect(
  [
    "daily_operational_closures",
    "day_close_events",
    "recount_lines",
    "recount_sessions",
    "variance_adjustments",
  ],
  SUPER_MANAGER_INVENTORY,
);
allowSelect(
  [
    "stock_request_lines",
    "stock_requests",
    "transfer_discrepancies",
    "transfer_lines",
    "transfer_lot_allocations",
    "transfers",
  ],
  SUPER_MANAGER_INVENTORY,
);

allowDml(["application_settings"], ["insert", "update", "delete"], SUPER);
allowDml(
  [
    "barcodes",
    "branch_prices",
    "branches",
    "modifier_options",
    "modifiers",
    "product_variants",
    "products",
    "unit_conversions",
    "units",
  ],
  ["insert", "update", "delete"],
  SUPER,
);
allowDml(["categories", "inventory_items"], ["insert", "update"], SUPER);
allowDml(["permissions", "role_permissions", "roles"], ["insert", "update", "delete"], SUPER);
allowDml(["profiles"], ["insert", "delete"], SUPER);
allowDml(["profiles"], ["update"], ALL);
allowDml(["user_branch_assignments", "user_roles"], ["insert", "update", "delete"], SUPER);
allowDml(
  ["supplier_items", "supplier_return_lines", "supplier_returns"],
  ["insert", "update", "delete"],
  SUPER,
);
allowDml(["suppliers"], ["insert", "update"], SUPER);
allowDml(["supplier_prices"], ["insert"], SUPER);
allowDml(["purchase_order_lines"], ["insert", "update", "delete"], SUPER_MANAGER);
allowDml(["purchase_orders"], ["insert", "update"], SUPER_MANAGER);
allowDml(
  ["purchase_receipt_lines", "purchase_receipts"],
  ["insert", "update", "delete"],
  SUPER_INVENTORY,
);
allowDml(["recipe_lines", "recipe_versions"], ["insert", "update", "delete"], SUPER);
allowDml(["recipes"], ["insert", "update"], SUPER);
allowDml(["production_templates"], ["insert", "update"], SUPER_PRODUCTION);
allowDml(["production_order_inputs", "production_orders"], ["update"], SUPER_PRODUCTION);

const PROTECTED_DIRECT_DML_TABLES = [
  "audit_logs",
  "backup_runs",
  "calendar_event_commands",
  "calendar_events",
  "cost_snapshots",
  "daily_operational_closures",
  "day_close_events",
  "inventory_alerts",
  "inventory_balances",
  "inventory_lots",
  "loyverse_mapping_commands",
  "loyverse_mappings",
  "notification_deliveries",
  "notification_events",
  "notification_receipts",
  "notifications",
  "offline_conflict_resolutions",
  "offline_snapshot_items",
  "offline_snapshots",
  "offline_submission_items",
  "offline_submissions",
  "popup_event_commands",
  "pos_import_postings",
  "pos_import_rows",
  "pos_imports",
  "recount_lines",
  "recount_sessions",
  "recycle_bin_commands",
  "recycle_purge_runs",
  "retention_holds",
  "stock_request_lines",
  "stock_requests",
  "stock_transaction_lines",
  "stock_transactions",
  "transfer_discrepancies",
  "transfer_lines",
  "transfer_lot_allocations",
  "transfers",
  "variance_adjustments",
] as const;

const EMAIL_LIKE = "phase11-rls+%@zombeans.test";
const marker = crypto.randomUUID().slice(0, 8);
const branchKeyA = `p11-rls-a-${marker}`;
const branchKeyB = `p11-rls-b-${marker}`;
const sku = `P11-RLS-${marker.toUpperCase()}`;

let admin: Client;
let acting: Client;
const users = {} as Record<AppRole, string>;
const fixture = {} as {
  branchA: string;
  branchB: string;
  item: string;
  unit: string;
  txnA: string;
  txnB: string;
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function asAnon<T>(client: Client, fn: (c: Client) => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role: "anon" }),
    ]);
    await client.query("set local role anon");
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

async function probeWithSavepoint(client: Client, statement: string) {
  await client.query("savepoint phase11_probe");
  try {
    const result = await client.query(statement);
    await client.query("rollback to savepoint phase11_probe");
    await client.query("release savepoint phase11_probe");
    return { result, error: null };
  } catch (error) {
    await client.query("rollback to savepoint phase11_probe");
    await client.query("release savepoint phase11_probe");
    return { result: null, error: error as Error };
  }
}

async function cleanupFixtures() {
  await admin.query(`delete from public.stock_transaction_lines where item_id = $1`, [
    fixture.item,
  ]);
  await admin.query(`delete from public.stock_transactions where id = any($1::uuid[])`, [
    [fixture.txnA, fixture.txnB].filter(Boolean),
  ]);
  await admin.query(`delete from public.inventory_lots where item_id = $1`, [fixture.item]);
  await admin.query(`delete from public.inventory_balances where item_id = $1`, [fixture.item]);
  await admin.query(`delete from public.inventory_items where id = $1`, [fixture.item]);
  await admin.query(`delete from public.branches where id = any($1::uuid[])`, [
    [fixture.branchA, fixture.branchB].filter(Boolean),
  ]);
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupUsers(admin, EMAIL_LIKE);

  users.super = await createUser(admin, "phase11-rls+super@zombeans.test");
  users.manager = await createUser(admin, "phase11-rls+manager@zombeans.test");
  users.production = await createUser(admin, "phase11-rls+production@zombeans.test");
  users.inventory = await createUser(admin, "phase11-rls+inventory@zombeans.test");
  await assignRole(admin, users.super, "super_admin");
  await assignRole(admin, users.manager, "branch_manager");
  await assignRole(admin, users.production, "production");
  await assignRole(admin, users.inventory, "inventory");

  fixture.unit = (await admin.query(`select id from public.units where code = 'g'`)).rows[0]!.id;
  fixture.branchA = (
    await admin.query<{ id: string; key: string }>(
      `insert into public.branches (key, name, created_by, updated_by)
       values ($1, 'Phase 11 RLS A', $3, $3), ($2, 'Phase 11 RLS B', $3, $3)
       returning id, key`,
      [branchKeyA, branchKeyB, users.super],
    )
  ).rows.find((row) => row.key === branchKeyA)!.id;
  fixture.branchB = (
    await admin.query<{ id: string }>(`select id from public.branches where key = $1`, [branchKeyB])
  ).rows[0]!.id;

  for (const role of ["manager", "production", "inventory"] as const) {
    await admin.query(
      `insert into public.user_branch_assignments (profile_id, branch_id, assigned_by)
       values ($1, $2, $3)`,
      [users[role], fixture.branchA, users.super],
    );
  }

  fixture.item = (
    await admin.query<{ id: string }>(
      `insert into public.inventory_items
         (name, sku, item_type, base_unit_id, weighted_avg_cost, created_by, updated_by)
       values ('Phase 11 scoped item', $1, 'packaging', $2, 999, $3, $3)
       returning id`,
      [sku, fixture.unit, users.super],
    )
  ).rows[0]!.id;
  await admin.query(
    `insert into public.inventory_balances (item_id, branch_id, qty_on_hand)
     values ($1, $2, 11), ($1, $3, 22)`,
    [fixture.item, fixture.branchA, fixture.branchB],
  );
  await admin.query(
    `insert into public.inventory_lots
       (item_id, branch_id, lot_number, qty_remaining, unit_cost, status)
     values ($1, $2, 'P11-LOT-A', 11, 999, 'available'),
            ($1, $3, 'P11-LOT-B', 22, 999, 'available')`,
    [fixture.item, fixture.branchA, fixture.branchB],
  );
  const transactions = await admin.query<{ id: string; reference: string }>(
    `insert into public.stock_transactions
       (reference, type, status, dest_branch_id, reason, created_by, approved_by,
        confirmed_at, idempotency_key, correlation_id)
     values ($1, 'stock_in', 'posted', $3, 'Phase 11 branch A', $5, $5, now(), $6, gen_random_uuid()),
            ($2, 'stock_in', 'posted', $4, 'Phase 11 branch B', $5, $5, now(), $7, gen_random_uuid())
     returning id, reference`,
    [
      `P11-RLS-A-${marker}`,
      `P11-RLS-B-${marker}`,
      fixture.branchA,
      fixture.branchB,
      users.super,
      crypto.randomUUID(),
      crypto.randomUUID(),
    ],
  );
  fixture.txnA = transactions.rows.find((row) => row.reference.includes("-A-"))!.id;
  fixture.txnB = transactions.rows.find((row) => row.reference.includes("-B-"))!.id;
  await admin.query(
    `insert into public.stock_transaction_lines
       (txn_id, item_id, qty, unit_id, unit_cost_snapshot)
     values ($1, $3, 11, $4, 999), ($2, $3, 22, $4, 999)`,
    [fixture.txnA, fixture.txnB, fixture.item, fixture.unit],
  );
}, 60_000);

afterAll(async () => {
  await cleanupFixtures();
  await cleanupUsers(admin, EMAIL_LIKE);
  await acting.end();
  await admin.end();
});

describe("Phase 11 complete table/role/verb authorization matrix", () => {
  it("enumerates every public business table exactly once", async () => {
    const result = await admin.query<{ table_name: string }>(
      `select tablename table_name from pg_tables
       where schemaname = 'public' order by tablename`,
    );
    expect([...contract.keys()].sort()).toEqual(result.rows.map((row) => row.table_name));
  });

  it("matches the explicit matrix to effective grants and RLS command policies", async () => {
    const result = await admin.query<{
      table_name: string;
      select_grant: boolean;
      insert_grant: boolean;
      update_grant: boolean;
      delete_grant: boolean;
      policy_commands: string[];
    }>(
      `select c.relname table_name,
         has_table_privilege('authenticated', c.oid, 'SELECT')
           or has_any_column_privilege('authenticated', c.oid, 'SELECT') select_grant,
         has_table_privilege('authenticated', c.oid, 'INSERT')
           or has_any_column_privilege('authenticated', c.oid, 'INSERT') insert_grant,
         has_table_privilege('authenticated', c.oid, 'UPDATE')
           or has_any_column_privilege('authenticated', c.oid, 'UPDATE') update_grant,
         has_table_privilege('authenticated', c.oid, 'DELETE') delete_grant,
         coalesce(array_agg(distinct p.cmd) filter (where p.cmd is not null), '{}'::text[])
           policy_commands
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
       where n.nspname = 'public' and c.relkind = 'r'
       group by c.oid, c.relname
       order by c.relname`,
    );

    for (const row of result.rows) {
      const expected = contract.get(row.table_name)!;
      for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
        const roles = expected[verb.toLowerCase() as Lowercase<Verb>];
        const grant = row[`${verb.toLowerCase()}_grant` as keyof typeof row] as boolean;
        const policy = row.policy_commands.includes(verb) || row.policy_commands.includes("ALL");
        expect(grant && policy, `${row.table_name} ${verb}`).toBe(roles.length > 0);
      }
    }
  });

  for (const role of APP_ROLES) {
    it(`${role} SELECT visibility matches every table contract`, async () => {
      const grantedColumns = await admin.query<{ table_name: string; column_name: string }>(
        `select distinct on (c.table_name) c.table_name, c.column_name
         from information_schema.columns c
         where c.table_schema = 'public'
           and has_column_privilege(
             'authenticated', format('%I.%I', c.table_schema, c.table_name), c.column_name, 'SELECT'
           )
         order by c.table_name, c.ordinal_position`,
      );
      const columnByTable = new Map(
        grantedColumns.rows.map((row) => [row.table_name, row.column_name]),
      );

      await asUser(acting, users[role], async (client) => {
        for (const table of BUSINESS_TABLES) {
          const column = columnByTable.get(table);
          const statement = column
            ? `select ${quoteIdentifier(column)} from public.${quoteIdentifier(table)} limit 25`
            : `select count(*) from public.${quoteIdentifier(table)}`;
          const probe = await probeWithSavepoint(client, statement);
          const expected = contract.get(table)!.select.includes(role);
          if (expected) {
            expect(probe.error, `${role} should SELECT ${table}`).toBeNull();
          } else if (!probe.error) {
            expect(
              (probe.result as QueryResult).rows,
              `${role} should see no rows from ${table}`,
            ).toHaveLength(0);
          } else {
            expect(probe.error.message).toMatch(/permission denied|row-level security/i);
          }
        }
      });
    });
  }

  it("anon is denied every verb on every business table", async () => {
    await asAnon(acting, async (client) => {
      const columns = await admin.query<{ table_name: string; column_name: string }>(
        `select distinct on (table_name) table_name, column_name
         from information_schema.columns where table_schema = 'public'
         order by table_name, ordinal_position`,
      );
      const columnByTable = new Map(columns.rows.map((row) => [row.table_name, row.column_name]));
      for (const table of BUSINESS_TABLES) {
        const name = `public.${quoteIdentifier(table)}`;
        const column = quoteIdentifier(columnByTable.get(table)!);
        const statements = [
          `select count(*) from ${name}`,
          `insert into ${name} default values`,
          `update ${name} set ${column} = ${column} where false`,
          `delete from ${name} where false`,
        ];
        for (const statement of statements) {
          const probe = await probeWithSavepoint(client, statement);
          expect(probe.error?.message, `anon must be denied: ${statement}`).toMatch(
            /permission denied|row-level security/i,
          );
        }
      }
    });
  });

  for (const role of APP_ROLES) {
    it(`${role} has no direct DML path into ledger/lifecycle/offline/POS tables`, async () => {
      await asUser(acting, users[role], async (client) => {
        const columns = await admin.query<{ table_name: string; column_name: string }>(
          `select distinct on (table_name) table_name, column_name
           from information_schema.columns
           where table_schema = 'public' and table_name = any($1::text[])
           order by table_name, ordinal_position`,
          [PROTECTED_DIRECT_DML_TABLES],
        );
        const columnByTable = new Map(columns.rows.map((row) => [row.table_name, row.column_name]));
        for (const table of PROTECTED_DIRECT_DML_TABLES) {
          const name = `public.${quoteIdentifier(table)}`;
          const column = quoteIdentifier(columnByTable.get(table)!);
          for (const statement of [
            `insert into ${name} default values`,
            `update ${name} set ${column} = ${column} where false`,
            `delete from ${name} where false`,
          ]) {
            const probe = await probeWithSavepoint(client, statement);
            expect(probe.error?.message, `${role} must be denied: ${statement}`).toMatch(
              /permission denied|row-level security/i,
            );
          }
        }
      });
    });
  }
});

describe("Phase 11 branch-scope penetration", () => {
  for (const role of ["manager", "production", "inventory"] as const) {
    it(`${role} cannot read another branch's balances, lots, ledger headers, or lines`, async () => {
      const result = await asUser(acting, users[role], async (client) => {
        const balances = await client.query<{ qty: string }>(
          `select qty_on_hand::text qty from public.inventory_balances where item_id = $1`,
          [fixture.item],
        );
        const lots = await client.query<{ lot_number: string }>(
          `select lot_number from public.inventory_lots where item_id = $1 order by lot_number`,
          [fixture.item],
        );
        const transactions = await client.query<{ reference: string }>(
          `select reference from public.stock_transactions
             where id = any($1::uuid[]) order by reference`,
          [[fixture.txnA, fixture.txnB]],
        );
        const lines = await client.query<{ txn_id: string }>(
          `select txn_id from public.stock_transaction_lines
             where txn_id = any($1::uuid[]) order by txn_id`,
          [[fixture.txnA, fixture.txnB]],
        );
        return {
          balances: balances.rows,
          lots: lots.rows,
          transactions: transactions.rows,
          lines: lines.rows,
        };
      });

      expect(result.balances).toEqual([{ qty: "11.0000" }]);
      expect(result.lots).toEqual([{ lot_number: "P11-LOT-A" }]);
      expect(result.transactions).toEqual([{ reference: `P11-RLS-A-${marker}` }]);
      expect(result.lines).toEqual([{ txn_id: fixture.txnA }]);
    });
  }

  it("Super Admin retains authorized cross-branch visibility", async () => {
    const result = await asUser(acting, users.super, (client) =>
      client.query<{ qty: string }>(
        `select qty_on_hand::text qty from public.inventory_balances
         where item_id = $1 order by qty_on_hand`,
        [fixture.item],
      ),
    );
    expect(result.rows).toEqual([{ qty: "11.0000" }, { qty: "22.0000" }]);
  });
});
