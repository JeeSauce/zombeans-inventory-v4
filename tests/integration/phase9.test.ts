import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, assignBranch, assignRole, cleanupUsers, connect, createUser } from "./helpers/db";

const EMAIL_LIKE = "phase9+%@zombeans.test";
const PREFIX = "P9 Gate";
let admin: Client;
let acting: Client;
const users = { super: "", manager: "", production: "", inventory: "" };
const fixture = {
  branchAllowed: "",
  branchDenied: "",
  unit: "",
  reportCategory: "",
  reportItem: "",
  restoreCategory: "",
  eligibleCategory: "",
  protectedCategory: "",
  insideCategory: "",
  auditCategory: "",
  ledgerItem: "",
};

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

async function runAsServiceRoleAndCommit<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  await acting.query("begin");
  try {
    await acting.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role: "service_role" }),
    ]);
    await acting.query("set local role service_role");
    const result = await fn(acting);
    await acting.query("commit");
    return result;
  } catch (error) {
    await acting.query("rollback");
    throw error;
  }
}

async function cleanupPhase9() {
  await admin.query("begin");
  try {
    await admin.query(`select set_config('zombeans.lifecycle_command', 'on', true)`);
    await admin.query("alter table public.recycle_bin_commands disable trigger user");
    await admin.query(
      `delete from public.recycle_bin_commands where idempotency_key like 'phase9:%'`,
    );
    await admin.query(`delete from public.recycle_purge_runs where run_key like 'phase9:%'`);
    await admin.query(`delete from public.backup_runs where run_key like 'phase9:%'`);
    await admin.query(`delete from public.retention_holds where reason like '${PREFIX}%'`);
    await admin.query(`delete from public.inventory_balances where item_id in (
      select id from public.inventory_items where sku like 'P9-%'
    )`);
    await admin.query(`delete from public.stock_transaction_lines where item_id in (
      select id from public.inventory_items where sku like 'P9-%'
    )`);
    await admin.query(`delete from public.stock_transactions where reference like 'P9-%'`);
    await admin.query(`delete from public.inventory_items where sku like 'P9-%'`);
    await admin.query(`delete from public.categories where name like '${PREFIX}%'`);
    await admin.query(
      `delete from public.user_branch_assignments where profile_id in (
      select id from public.profiles where email like $1
    )`,
      [EMAIL_LIKE],
    );
    await admin.query(`delete from public.branches where key like 'phase9-%'`);
    await admin.query(`delete from public.units where code = 'p9u'`);
    await admin.query(`delete from public.audit_logs where (
      entity_type in ('category', 'inventory_item', 'backup_run')
      and (
        reason like '${PREFIX}%'
        or action like 'recycle.%'
        or action like 'retention.%'
        or action = 'backup.run_recorded'
      )
    ) or action = 'phase9.preexisting'`);
    await admin.query("alter table public.recycle_bin_commands enable trigger user");
    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback");
    throw error;
  }
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupPhase9();
  await cleanupUsers(admin, EMAIL_LIKE);

  users.super = await createUser(admin, "phase9+super@zombeans.test", { fullName: "P9 Super" });
  users.manager = await createUser(admin, "phase9+manager@zombeans.test", {
    fullName: "P9 Manager",
  });
  users.production = await createUser(admin, "phase9+production@zombeans.test", {
    fullName: "P9 Production",
  });
  users.inventory = await createUser(admin, "phase9+inventory@zombeans.test", {
    fullName: "P9 Inventory",
  });
  await assignRole(admin, users.super, "super_admin");
  await assignRole(admin, users.manager, "branch_manager");
  await assignRole(admin, users.production, "production");
  await assignRole(admin, users.inventory, "inventory");

  fixture.branchAllowed = (
    await admin.query<{ id: string }>(
      `insert into public.branches (key, name, active) values ('phase9-allowed', '${PREFIX} Allowed', true) returning id`,
    )
  ).rows[0]!.id;
  fixture.branchDenied = (
    await admin.query<{ id: string }>(
      `insert into public.branches (key, name, active) values ('phase9-denied', '${PREFIX} Denied', true) returning id`,
    )
  ).rows[0]!.id;
  fixture.unit = (
    await admin.query<{ id: string }>(
      `insert into public.units (code, name, dimension) values ('p9u', '${PREFIX} Unit', 'count') returning id`,
    )
  ).rows[0]!.id;
  fixture.reportCategory = (
    await admin.query<{ id: string }>(
      `insert into public.categories (name, item_type, active) values ('${PREFIX} Report', 'packaging', true) returning id`,
    )
  ).rows[0]!.id;
  fixture.reportItem = (
    await admin.query<{ id: string }>(
      `insert into public.inventory_items (
        name, sku, item_type, category_id, base_unit_id, weighted_avg_cost, active
      ) values ('${PREFIX} Report Item', 'P9-REPORT', 'packaging', $1, $2, 12.5, true) returning id`,
      [fixture.reportCategory, fixture.unit],
    )
  ).rows[0]!.id;
  fixture.ledgerItem = (
    await admin.query<{ id: string }>(
      `insert into public.inventory_items (
        name, sku, item_type, category_id, base_unit_id, weighted_avg_cost, active,
        deleted_at, deleted_by, purge_at
      ) values ('${PREFIX} Ledger Item', 'P9-LEDGER', 'packaging', $1, $2, 5, true,
        now() - interval '31 days', $3, now() - interval '1 day') returning id`,
      [fixture.reportCategory, fixture.unit, users.super],
    )
  ).rows[0]!.id;
  await admin.query(
    `insert into public.inventory_balances (item_id, branch_id, qty_on_hand)
     values ($1,$2,5),($1,$3,9),($4,$2,1)`,
    [fixture.reportItem, fixture.branchAllowed, fixture.branchDenied, fixture.ledgerItem],
  );
  const transactionId = (
    await admin.query<{ id: string }>(
      `insert into public.stock_transactions (
        reference, type, status, dest_branch_id, reason, idempotency_key, created_at
      ) values ('P9-TXN-001','stock_in','posted',$1,'${PREFIX} seed','phase9:txn:001',now()) returning id`,
      [fixture.branchAllowed],
    )
  ).rows[0]!.id;
  await admin.query(
    `insert into public.stock_transaction_lines (txn_id,item_id,qty,unit_id,unit_cost_snapshot)
     values ($1,$2,5,$3,11.25)`,
    [transactionId, fixture.reportItem, fixture.unit],
  );
  await assignBranch(admin, users.inventory, fixture.branchAllowed);
  await assignBranch(admin, users.production, fixture.branchAllowed);

  const categoryRows = await admin.query<{ id: string; name: string }>(
    `insert into public.categories (name, item_type, active, deleted_at, deleted_by, purge_at)
     values
       ('${PREFIX} Restore','packaging',true,null,null,null),
       ('${PREFIX} Eligible','packaging',true,now()-interval '31 days',$1,now()-interval '1 day'),
       ('${PREFIX} Protected','packaging',true,now()-interval '31 days',$1,now()-interval '1 day'),
       ('${PREFIX} Inside','packaging',true,now()-interval '5 days',$1,now()+interval '25 days'),
       ('${PREFIX} Audit','packaging',true,now()-interval '31 days',$1,now()-interval '1 day')
     returning id,name`,
    [users.super],
  );
  for (const row of categoryRows.rows) {
    if (row.name.endsWith("Restore")) fixture.restoreCategory = row.id;
    if (row.name.endsWith("Eligible")) fixture.eligibleCategory = row.id;
    if (row.name.endsWith("Protected")) fixture.protectedCategory = row.id;
    if (row.name.endsWith("Inside")) fixture.insideCategory = row.id;
    if (row.name.endsWith("Audit")) fixture.auditCategory = row.id;
  }
  await admin.query(
    `insert into public.retention_holds (
      entity_type,entity_id,dependency_type,reason,idempotency_key,placed_by
    ) values ('category',$1,'legal','${PREFIX} legal case','phase9:hold:protected',$2)`,
    [fixture.protectedCategory, users.super],
  );
  await admin.query(
    `insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
     values ($1,'phase9.preexisting','category',$2,'${PREFIX} audit survival')`,
    [users.super, fixture.auditCategory],
  );
}, 60_000);

afterAll(async () => {
  await cleanupPhase9();
  await cleanupUsers(admin, EMAIL_LIKE);
  await admin.end();
  await acting.end();
});

describe("Phase 9 reports and financial isolation", () => {
  it("all operational roles receive cost-free reports and non-Super roles cannot call financial RPC", async () => {
    for (const userId of Object.values(users)) {
      const report = await asUser(acting, userId, async (client) => {
        const result = await client.query<{ report: Record<string, unknown> }>(
          `select public.get_operational_report(
            'inventory-balances', current_date-30, current_date, $1, $2, 'packaging'
          ) report`,
          [fixture.branchAllowed, fixture.reportCategory],
        );
        return result.rows[0]!.report;
      });
      expect(report.reportClass).toBe("operational");
      expect(JSON.stringify(report)).not.toMatch(
        /unitCost|totalValue|supplier.?price|varianceValue/i,
      );
    }
    for (const userId of [users.manager, users.production, users.inventory]) {
      await expect(
        asUser(acting, userId, (client) =>
          client.query(
            `select public.get_financial_report(
              'inventory-valuation',current_date-30,current_date,$1,$2,'packaging'
            )`,
            [fixture.branchAllowed, fixture.reportCategory],
          ),
        ),
      ).rejects.toThrow(/cost\.read required/i);
    }
    const financial = await asUser(acting, users.super, async (client) => {
      const result = await client.query<{ report: { summary: { totalValue: number } } }>(
        `select public.get_financial_report(
          'inventory-valuation',current_date-30,current_date,$1,$2,'packaging'
        ) report`,
        [fixture.branchAllowed, fixture.reportCategory],
      );
      return result.rows[0]!.report;
    });
    expect(Number(financial.summary.totalValue)).toBe(62.5);
  });

  it("enforces branch scope and validates report date ranges inside Postgres", async () => {
    await expect(
      asUser(acting, users.inventory, (client) =>
        client.query(
          `select public.get_operational_report(
            'inventory-balances',current_date-30,current_date,$1,null,null
          )`,
          [fixture.branchDenied],
        ),
      ),
    ).rejects.toThrow(/branch access required/i);
    await expect(
      asUser(acting, users.super, (client) =>
        client.query(
          `select public.get_operational_report(
            'inventory-balances',current_date,current_date-1,null,null,null
          )`,
        ),
      ),
    ).rejects.toThrow(/start date must be/i);
  });
});

describe("critical scenario 14 — restore before purge", () => {
  it("hides a soft-deleted record, exposes it only to Super Admin, restores exact business values, and replays", async () => {
    const before = (
      await admin.query(`select name,item_type::text,active from public.categories where id=$1`, [
        fixture.restoreCategory,
      ])
    ).rows[0];
    await runAsUserAndCommit(users.super, (client) =>
      client.query(
        `select public.soft_delete_record('category',$1,'${PREFIX} duplicate category','phase9:delete:restore')`,
        [fixture.restoreCategory],
      ),
    );
    const hidden = await asUser(
      acting,
      users.manager,
      async (client) =>
        (
          await client.query(`select count(*)::int n from public.categories where id=$1`, [
            fixture.restoreCategory,
          ])
        ).rows[0].n,
    );
    expect(hidden).toBe(0);
    const listed = await asUser(
      acting,
      users.super,
      async (client) =>
        (
          await client.query(`select label from public.list_recycle_bin() where entity_id=$1`, [
            fixture.restoreCategory,
          ])
        ).rows,
    );
    expect(listed).toEqual([{ label: `${PREFIX} Restore` }]);
    await expect(
      asUser(acting, users.manager, (client) =>
        client.query(
          `select public.restore_recycle_record('category',$1,'not allowed','phase9:restore:manager')`,
          [fixture.restoreCategory],
        ),
      ),
    ).rejects.toThrow(/recyclebin\.restore required/i);
    const first = await runAsUserAndCommit(
      users.super,
      async (client) =>
        (
          await client.query<{ result: { replayed: boolean } }>(
            `select public.restore_recycle_record('category',$1,'${PREFIX} needed again','phase9:restore:restore') result`,
            [fixture.restoreCategory],
          )
        ).rows[0]!.result,
    );
    const replay = await runAsUserAndCommit(
      users.super,
      async (client) =>
        (
          await client.query<{ result: { replayed: boolean } }>(
            `select public.restore_recycle_record('category',$1,'${PREFIX} needed again','phase9:restore:restore') result`,
            [fixture.restoreCategory],
          )
        ).rows[0]!.result,
    );
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    const after = (
      await admin.query(`select name,item_type::text,active from public.categories where id=$1`, [
        fixture.restoreCategory,
      ])
    ).rows[0];
    expect(after).toEqual(before);
  });
});

describe("critical scenario 15 — eligibility-aware purge", () => {
  it("purges expired dependency-free rows, protects held/inside-window/ledger rows, and replays safely", async () => {
    const result = await runAsUserAndCommit(
      users.super,
      async (client) =>
        (
          await client.query<{
            result: { purgedCount: number; skippedCount: number; replayed: boolean };
          }>(`select public.purge_recycle_bin('phase9:purge:gate',100) result`)
        ).rows[0]!.result,
    );
    expect(result.purgedCount).toBeGreaterThanOrEqual(2);
    expect(result.skippedCount).toBeGreaterThanOrEqual(2);
    const remaining = await admin.query(
      `select id from public.categories where id = any($1::uuid[])
       union all select id from public.inventory_items where id=$2`,
      [[fixture.protectedCategory, fixture.insideCategory], fixture.ledgerItem],
    );
    expect(remaining.rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([
        fixture.protectedCategory,
        fixture.insideCategory,
        fixture.ledgerItem,
      ]),
    );
    expect(
      (await admin.query(`select 1 from public.categories where id=$1`, [fixture.eligibleCategory]))
        .rowCount,
    ).toBe(0);
    expect(
      (await admin.query(`select 1 from public.categories where id=$1`, [fixture.auditCategory]))
        .rowCount,
    ).toBe(0);
    const replay = await runAsUserAndCommit(
      users.super,
      async (client) =>
        (
          await client.query<{ result: { purgedCount: number; replayed: boolean } }>(
            `select public.purge_recycle_bin('phase9:purge:gate',100) result`,
          )
        ).rows[0]!.result,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.purgedCount).toBe(result.purgedCount);
  });
});

describe("critical scenario 16 — audit survives delete and purge", () => {
  it("keeps pre-existing and purge audit rows after the business row is gone, with audit.read RLS", async () => {
    const auditRows = await asUser(
      acting,
      users.super,
      async (client) =>
        (
          await client.query(
            `select action from public.audit_logs where entity_type='category' and entity_id=$1 order by created_at`,
            [fixture.auditCategory],
          )
        ).rows,
    );
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["phase9.preexisting", "recycle.purged"]),
    );
    const managerCount = await asUser(
      acting,
      users.manager,
      async (client) =>
        (
          await client.query(
            `select count(*)::int n from public.audit_logs where entity_type='category' and entity_id=$1`,
            [fixture.auditCategory],
          )
        ).rows[0].n,
    );
    expect(managerCount).toBe(0);
  });
});

describe("Phase 9 backstops and backup metadata", () => {
  it("blocks direct lifecycle updates/hard deletes even for an authenticated Super Admin", async () => {
    await expect(
      asUser(acting, users.super, (client) =>
        client.query(`update public.categories set deleted_at=now() where id=$1`, [
          fixture.restoreCategory,
        ]),
      ),
    ).rejects.toThrow(/lifecycle columns must use/i);
    await expect(
      asUser(acting, users.super, (client) =>
        client.query(`delete from public.categories where id=$1`, [fixture.restoreCategory]),
      ),
    ).rejects.toThrow(/permission denied|hard delete must use/i);
  });

  it("gates recycle and backup metadata to their Super-Admin permissions", async () => {
    await expect(
      asUser(acting, users.manager, (client) =>
        client.query(`select * from public.list_recycle_bin()`),
      ),
    ).rejects.toThrow(/recyclebin\.restore required/i);
    await expect(
      asUser(acting, users.manager, (client) => client.query(`select public.get_backup_status()`)),
    ).rejects.toThrow(/backup\.manage required/i);
    const startedAt = "2026-07-14T01:00:00.000Z";
    const recorded = await runAsServiceRoleAndCommit(async (client) => {
      const parameters = [
        "phase9:backup:001",
        "P9-BACKUP-001",
        "pg_dump",
        "succeeded",
        "Encrypted offsite vault",
        true,
        startedAt,
        "2026-07-14T01:05:00.000Z",
        "2026-08-13",
        1024,
        "2026-07-14T01:10:00.000Z",
        null,
      ];
      const first = await client.query<{ result: { replayed: boolean } }>(
        `select public.record_backup_run($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result`,
        parameters,
      );
      const replay = await client.query<{ result: { replayed: boolean } }>(
        `select public.record_backup_run($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result`,
        parameters,
      );
      return [first.rows[0]!.result, replay.rows[0]!.result];
    });
    expect(recorded).toMatchObject([{ replayed: false }, { replayed: true }]);

    const backup = await asUser(
      acting,
      users.super,
      async (client) =>
        (
          await client.query<{
            status: { latest: { reference: string; encrypted: boolean }; history: unknown[] };
          }>(`select public.get_backup_status() status`)
        ).rows[0]!.status,
    );
    expect(backup.latest).toMatchObject({ reference: "P9-BACKUP-001", encrypted: true });
    expect(backup.history).toHaveLength(1);
  });
});
