import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignRole, cleanupUsers, connect, createUser } from "./helpers/db";

const EMAIL_PATTERN = "%@phase10.test";
const SKU = "PHASE10-ITEM";
let admin: Client;
let acting: Client;
const users = { manager: "", inventory: "" };
const base = { branch: "", unit: "", item: "", today: "" };

async function asCommit<T>(userId: string, fn: (client: Client) => Promise<T>): Promise<T> {
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

async function cleanup(client: Client) {
  const auditIds = await client.query<{ id: string }>(
    `select id from public.audit_logs
     where actor_id in (select id from public.profiles where email like $1)
       and (action like 'offline.%' or action like 'pos.%' or action like 'loyverse.%')`,
    [EMAIL_PATTERN],
  );
  const triggers = [
    ["offline_snapshot_items", "offline_snapshot_items_append_only"],
    ["offline_submission_items", "offline_submission_items_append_only"],
    ["offline_conflict_resolutions", "offline_conflict_resolutions_append_only"],
    ["loyverse_mapping_commands", "loyverse_mapping_commands_append_only"],
    ["pos_import_rows", "pos_import_rows_append_only"],
    ["pos_import_postings", "pos_import_postings_append_only"],
  ] as const;
  for (const [table, trigger] of triggers) {
    await client.query(`alter table public.${table} disable trigger ${trigger}`);
  }
  try {
    await client.query(
      `delete from public.offline_conflict_resolutions where submission_id in (
         select id from public.offline_submissions where branch_id in (
           select id from public.branches where key = 'phase10-branch'
         )
       )`,
    );
    await client.query(
      `delete from public.offline_submission_items where submission_id in (
         select id from public.offline_submissions where branch_id in (
           select id from public.branches where key = 'phase10-branch'
         )
       )`,
    );
    await client.query(
      `delete from public.offline_submissions where branch_id in (
         select id from public.branches where key = 'phase10-branch'
       )`,
    );
    await client.query(
      `delete from public.offline_snapshot_items where snapshot_id in (
         select id from public.offline_snapshots where branch_id in (
           select id from public.branches where key = 'phase10-branch'
         )
       )`,
    );
    await client.query(
      `delete from public.offline_snapshots where branch_id in (
         select id from public.branches where key = 'phase10-branch'
       )`,
    );
    await client.query(
      `delete from public.pos_import_postings where import_id in (
         select id from public.pos_imports where branch_id in (
           select id from public.branches where key = 'phase10-branch'
         )
       )`,
    );
    await client.query(
      `delete from public.pos_import_rows where import_id in (
         select id from public.pos_imports where branch_id in (
           select id from public.branches where key = 'phase10-branch'
         )
       )`,
    );
    await client.query(
      `delete from public.pos_imports where branch_id in (
         select id from public.branches where key = 'phase10-branch'
       )`,
    );
    await client.query(
      `delete from public.loyverse_mapping_commands where mapping_id in (
         select id from public.loyverse_mappings where external_id like 'phase10-%'
       )`,
    );
    await client.query(`delete from public.loyverse_mappings where external_id like 'phase10-%'`);
    await client.query(
      `delete from public.variance_adjustments where session_id in (
         select rs.id from public.recount_sessions rs
         join public.branches b on b.id = rs.branch_id where b.key = 'phase10-branch'
       )`,
    );
    await client.query(
      `delete from public.recount_lines where session_id in (
         select rs.id from public.recount_sessions rs
         join public.branches b on b.id = rs.branch_id where b.key = 'phase10-branch'
       )`,
    );
    await client.query(
      `delete from public.recount_sessions where branch_id in (
         select id from public.branches where key = 'phase10-branch'
       )`,
    );
    await client.query(
      `delete from public.inventory_alerts where item_id in (
         select id from public.inventory_items where sku = $1
       )`,
      [SKU],
    );
    await client.query(
      `delete from public.stock_transactions where id in (
         select distinct stl.txn_id from public.stock_transaction_lines stl
         join public.inventory_items ii on ii.id = stl.item_id where ii.sku = $1
       )`,
      [SKU],
    );
    await client.query(
      `delete from public.inventory_lots where item_id in (
         select id from public.inventory_items where sku = $1
       )`,
      [SKU],
    );
    await client.query(
      `delete from public.inventory_balances where item_id in (
         select id from public.inventory_items where sku = $1
       )`,
      [SKU],
    );
    await client.query(
      `delete from public.barcodes where item_id in (
         select id from public.inventory_items where sku = $1
       )`,
      [SKU],
    );
    await client.query(`delete from public.inventory_items where sku = $1`, [SKU]);
    if (auditIds.rows.length) {
      await client.query(`delete from public.audit_logs where id = any($1::uuid[])`, [
        auditIds.rows.map((row) => row.id),
      ]);
    }
    await client.query(`delete from public.branches where key = 'phase10-branch'`);
  } finally {
    for (const [table, trigger] of triggers) {
      await client.query(`alter table public.${table} enable trigger ${trigger}`);
    }
  }
}

async function issueSnapshot(userId: string, draftId: string) {
  const result = await asCommit(userId, (client) =>
    client.query<{ result: { id: string; capturedAt: string; replayed: boolean } }>(
      `select public.issue_offline_snapshot(
         'recount', $1, $2, jsonb_build_array($3::text), null
       ) result`,
      [base.branch, draftId, base.item],
    ),
  );
  return result.rows[0]!.result;
}

async function submitRecount(
  userId: string,
  draftId: string,
  snapshotId: string,
  key: string,
  physicalQty: number,
) {
  const result = await asCommit(userId, (client) =>
    client.query<{
      result: { reference: string; status: string; replayed: boolean; conflictReason?: string };
    }>(
      `select public.submit_offline_recount(
         $1, $2, $3, $4, now(), $5, 'Offline integration recount',
         jsonb_build_array(jsonb_build_object('itemId', $6::text, 'physicalQty', $7::numeric))
       ) result`,
      [base.branch, base.today, draftId, snapshotId, key, base.item, physicalQty],
    ),
  );
  return result.rows[0]!.result;
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanup(admin);
  await cleanupUsers(admin, EMAIL_PATTERN);
  users.manager = await createUser(admin, "manager@phase10.test");
  users.inventory = await createUser(admin, "inventory@phase10.test");
  await assignRole(admin, users.manager, "branch_manager");
  await assignRole(admin, users.inventory, "inventory");
  base.unit = (await admin.query(`select id from public.units where code = 'g'`)).rows[0]!.id;
  base.today = (
    await admin.query<{ date: string }>(
      `select (now() at time zone 'Asia/Manila')::date::text as date`,
    )
  ).rows[0]!.date;
  base.branch = (
    await admin.query<{ id: string }>(
      `insert into public.branches (key, name, created_by, updated_by)
       values ('phase10-branch', 'Phase 10 Test Branch', $1, $1) returning id`,
      [users.manager],
    )
  ).rows[0]!.id;
  base.item = (
    await admin.query<{ id: string }>(
      `insert into public.inventory_items (
         name, sku, item_type, base_unit_id, trackable, weighted_avg_cost, created_by, updated_by
       ) values ('Phase 10 Coffee', $1, 'sub_product', $2, true, 10, $3, $3) returning id`,
      [SKU, base.unit, users.manager],
    )
  ).rows[0]!.id;
  await admin.query(
    `insert into public.barcodes (item_id, code, symbology, created_by, updated_by)
     values ($1, 'PHASE10-BARCODE', 'code128', $2, $2)`,
    [base.item, users.manager],
  );
  const seedTxn = await admin.query<{ id: string }>(
    `insert into public.stock_transactions (
       reference, type, status, dest_branch_id, reason, created_by, approved_by,
       confirmed_at, idempotency_key, correlation_id
     ) values ('PHASE10-SEED', 'stock_in', 'posted', $1, 'Phase 10 seed', $2, $2,
       now(), $3, gen_random_uuid()) returning id`,
    [base.branch, users.manager, crypto.randomUUID()],
  );
  const lot = await admin.query<{ id: string }>(
    `insert into public.inventory_lots (
       item_id, branch_id, lot_number, received_date, qty_remaining, unit_cost, status
     ) values ($1, $2, 'PHASE10-LOT', $3, 100, 10, 'available') returning id`,
    [base.item, base.branch, base.today],
  );
  await admin.query(
    `insert into public.stock_transaction_lines
       (txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot)
     values ($1, $2, 100, $3, $4, 10)`,
    [seedTxn.rows[0]!.id, base.item, base.unit, lot.rows[0]!.id],
  );
  await admin.query(
    `insert into public.inventory_balances (item_id, branch_id, qty_on_hand)
     values ($1, $2, 100)`,
    [base.item, base.branch],
  );
});

afterAll(async () => {
  await cleanup(admin);
  await cleanupUsers(admin, EMAIL_PATTERN);
  await acting.end();
  await admin.end();
});

describe("Phase 10 real-Postgres gates", () => {
  it("#17 prevents duplicate offline synchronization and posts the ledger once", async () => {
    const draftId = crypto.randomUUID();
    const key = crypto.randomUUID();
    const snapshot = await issueSnapshot(users.manager, draftId);
    const before = await admin.query<{ balance: string; txns: string; lines: string }>(
      `select
         (select qty_on_hand::text from public.inventory_balances where item_id=$1 and branch_id=$2) balance,
         (select count(*)::text from public.stock_transactions where type='recount_adjustment') txns,
         (select count(*)::text from public.stock_transaction_lines stl
            join public.stock_transactions st on st.id=stl.txn_id
            where st.type='recount_adjustment' and stl.item_id=$1) lines`,
      [base.item, base.branch],
    );
    const first = await submitRecount(users.manager, draftId, snapshot.id, key, 95);
    expect(first.status).toBe("posted");
    expect(first.replayed).toBe(false);
    const afterFirst = await admin.query<{ balance: string; txns: string; lines: string }>(
      `select
         (select qty_on_hand::text from public.inventory_balances where item_id=$1 and branch_id=$2) balance,
         (select count(*)::text from public.stock_transactions where type='recount_adjustment') txns,
         (select count(*)::text from public.stock_transaction_lines stl
            join public.stock_transactions st on st.id=stl.txn_id
            where st.type='recount_adjustment' and stl.item_id=$1) lines`,
      [base.item, base.branch],
    );
    expect(Number(afterFirst.rows[0]!.balance)).toBe(95);
    expect(Number(afterFirst.rows[0]!.txns) - Number(before.rows[0]!.txns)).toBe(1);
    expect(Number(afterFirst.rows[0]!.lines) - Number(before.rows[0]!.lines)).toBe(1);

    const replay = await submitRecount(users.manager, draftId, snapshot.id, key, 95);
    expect(replay.replayed).toBe(true);
    expect(replay.reference).toBe(first.reference);
    const afterReplay = await admin.query<{ balance: string; txns: string; lines: string }>(
      `select
         (select qty_on_hand::text from public.inventory_balances where item_id=$1 and branch_id=$2) balance,
         (select count(*)::text from public.stock_transactions where type='recount_adjustment') txns,
         (select count(*)::text from public.stock_transaction_lines stl
            join public.stock_transactions st on st.id=stl.txn_id
            where st.type='recount_adjustment' and stl.item_id=$1) lines`,
      [base.item, base.branch],
    );
    expect(afterReplay.rows[0]).toEqual(afterFirst.rows[0]);
  });

  it("#18 holds an overlapping stale recount for explicit review", async () => {
    const firstDraft = crypto.randomUUID();
    const secondDraft = crypto.randomUUID();
    const firstSnapshot = await issueSnapshot(users.manager, firstDraft);
    const secondSnapshot = await issueSnapshot(users.manager, secondDraft);
    const first = await submitRecount(
      users.manager,
      firstDraft,
      firstSnapshot.id,
      crypto.randomUUID(),
      90,
    );
    expect(first.status).toBe("posted");
    const ledgerBeforeConflict = await admin.query<{ count: string }>(
      `select count(*)::text from public.stock_transactions where type='recount_adjustment'`,
    );
    const second = await submitRecount(
      users.manager,
      secondDraft,
      secondSnapshot.id,
      crypto.randomUUID(),
      85,
    );
    expect(second.status).toBe("review_required");
    expect(second.conflictReason).toMatch(/moved after/i);
    const held = await admin.query<{ status: string; result_stock_txn_id: string | null }>(
      `select status, result_stock_txn_id from public.offline_submissions where reference=$1`,
      [second.reference],
    );
    expect(held.rows[0]).toEqual({ status: "review_required", result_stock_txn_id: null });
    expect(
      Number(
        (
          await admin.query<{ qty: string }>(
            `select qty_on_hand::text qty from public.inventory_balances where item_id=$1 and branch_id=$2`,
            [base.item, base.branch],
          )
        ).rows[0]!.qty,
      ),
    ).toBe(90);
    const ledgerAfterConflict = await admin.query<{ count: string }>(
      `select count(*)::text from public.stock_transactions where type='recount_adjustment'`,
    );
    expect(ledgerAfterConflict.rows[0]!.count).toBe(ledgerBeforeConflict.rows[0]!.count);

    const heldSubmission = await admin.query<{ id: string }>(
      `select id from public.offline_submissions where reference=$1`,
      [second.reference],
    );
    const resolution = await asCommit(users.manager, (client) =>
      client.query<{ result: { status: string; decision: string; replayed: boolean } }>(
        `select public.resolve_offline_conflict($1, 'reject', 'Physical count was superseded', $2) result`,
        [heldSubmission.rows[0]!.id, crypto.randomUUID()],
      ),
    );
    expect(resolution.rows[0]!.result).toMatchObject({
      status: "rejected",
      decision: "reject",
      replayed: false,
    });
  });

  it("#24 keeps preview inventory-side-effect-free and confirms idempotently", async () => {
    const mappingKey = crypto.randomUUID();
    await asCommit(users.manager, (client) =>
      client.query(
        `select public.upsert_loyverse_mapping(
           'item', 'phase10-item', 'Phase 10 Coffee', 'P10', $1, 1,
           'Integration mapping', $2
         )`,
        [base.item, mappingKey],
      ),
    );
    const before = await admin.query<{
      txns: string;
      lines: string;
      balance: string;
      lots: string;
    }>(
      `select
         (select count(*)::text from public.stock_transactions where type in ('pos_sale','pos_refund')) txns,
         (select count(*)::text from public.stock_transaction_lines stl join public.stock_transactions st on st.id=stl.txn_id where st.type in ('pos_sale','pos_refund')) lines,
         (select qty_on_hand::text from public.inventory_balances where item_id=$1 and branch_id=$2) balance,
         (select coalesce(sum(qty_remaining),0)::text from public.inventory_lots where item_id=$1 and branch_id=$2) lots`,
      [base.item, base.branch],
    );
    const previewKey = crypto.randomUUID();
    const preview = await asCommit(users.manager, (client) =>
      client.query<{ result: { id: string; reference: string; errorCount: number } }>(
        `select public.preview_pos_import($1, 'phase10.csv', $2, $3::jsonb) result`,
        [
          base.branch,
          previewKey,
          JSON.stringify([
            {
              rowNumber: 2,
              externalReference: "SALE-PHASE10",
              externalLineId: "LINE-PHASE10",
              occurredAt: new Date().toISOString(),
              movementType: "sale",
              entityType: "item",
              externalId: "phase10-item",
              quantity: 2,
            },
          ]),
        ],
      ),
    );
    expect(preview.rows[0]!.result.errorCount).toBe(0);
    const afterPreview = await admin.query<{
      txns: string;
      lines: string;
      balance: string;
      lots: string;
    }>(
      `select
         (select count(*)::text from public.stock_transactions where type in ('pos_sale','pos_refund')) txns,
         (select count(*)::text from public.stock_transaction_lines stl join public.stock_transactions st on st.id=stl.txn_id where st.type in ('pos_sale','pos_refund')) lines,
         (select qty_on_hand::text from public.inventory_balances where item_id=$1 and branch_id=$2) balance,
         (select coalesce(sum(qty_remaining),0)::text from public.inventory_lots where item_id=$1 and branch_id=$2) lots`,
      [base.item, base.branch],
    );
    expect(afterPreview.rows[0]).toEqual(before.rows[0]);

    const confirmKey = crypto.randomUUID();
    const confirm = await asCommit(users.manager, (client) =>
      client.query<{
        result: { status: string; replayed: boolean; transactionReferences: string[] };
      }>(`select public.confirm_pos_import($1, 'Reviewed valid preview', $2) result`, [
        preview.rows[0]!.result.id,
        confirmKey,
      ]),
    );
    expect(confirm.rows[0]!.result).toMatchObject({ status: "confirmed", replayed: false });
    expect(confirm.rows[0]!.result.transactionReferences).toHaveLength(1);
    const afterConfirm = await admin.query<{
      txns: string;
      lines: string;
      balance: string;
      lots: string;
    }>(
      `select
         (select count(*)::text from public.stock_transactions where type in ('pos_sale','pos_refund')) txns,
         (select count(*)::text from public.stock_transaction_lines stl join public.stock_transactions st on st.id=stl.txn_id where st.type in ('pos_sale','pos_refund')) lines,
         (select qty_on_hand::text from public.inventory_balances where item_id=$1 and branch_id=$2) balance,
         (select coalesce(sum(qty_remaining),0)::text from public.inventory_lots where item_id=$1 and branch_id=$2) lots`,
      [base.item, base.branch],
    );
    expect(Number(afterConfirm.rows[0]!.txns) - Number(before.rows[0]!.txns)).toBe(1);
    expect(Number(afterConfirm.rows[0]!.lines) - Number(before.rows[0]!.lines)).toBe(1);
    expect(Number(afterConfirm.rows[0]!.balance)).toBe(Number(before.rows[0]!.balance) - 2);
    expect(Number(afterConfirm.rows[0]!.lots)).toBe(Number(before.rows[0]!.lots) - 2);

    const replay = await asCommit(users.manager, (client) =>
      client.query<{ result: { replayed: boolean } }>(
        `select public.confirm_pos_import($1, 'Reviewed valid preview', $2) result`,
        [preview.rows[0]!.result.id, confirmKey],
      ),
    );
    expect(replay.rows[0]!.result.replayed).toBe(true);
    const afterReplay = await admin.query<{
      txns: string;
      lines: string;
      balance: string;
      lots: string;
    }>(
      `select
         (select count(*)::text from public.stock_transactions where type in ('pos_sale','pos_refund')) txns,
         (select count(*)::text from public.stock_transaction_lines stl join public.stock_transactions st on st.id=stl.txn_id where st.type in ('pos_sale','pos_refund')) lines,
         (select qty_on_hand::text from public.inventory_balances where item_id=$1 and branch_id=$2) balance,
         (select coalesce(sum(qty_remaining),0)::text from public.inventory_lots where item_id=$1 and branch_id=$2) lots`,
      [base.item, base.branch],
    );
    expect(afterReplay.rows[0]).toEqual(afterConfirm.rows[0]);
  });

  it("enforces permissions, RLS, barcode safety, and server-owned snapshots", async () => {
    const lookup = await asCommit(users.inventory, (client) =>
      client.query<{ result: { found: boolean; name: string; sku: string } }>(
        `select public.lookup_inventory_item_by_barcode('PHASE10-BARCODE') result`,
      ),
    );
    expect(lookup.rows[0]!.result).toMatchObject({ found: true, sku: SKU });

    await expect(
      asCommit(users.inventory, (client) =>
        client.query(`select public.preview_pos_import($1, 'forged.csv', $2, '[]'::jsonb)`, [
          base.branch,
          crypto.randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/pos.import/);
    await expect(
      asCommit(users.inventory, (client) =>
        client.query(
          `insert into public.offline_submissions (
             reference, submission_type, status, branch_id, client_draft_id, snapshot_id,
             client_created_at, snapshot_at, business_date, idempotency_key, payload,
             submitted_by, audit_log_id
           ) values ('FORGED', 'recount', 'synced', $1, gen_random_uuid(), gen_random_uuid(),
             now(), now(), $2, gen_random_uuid(), '{}'::jsonb, $3, gen_random_uuid())`,
          [base.branch, base.today, users.inventory],
        ),
      ),
    ).rejects.toThrow(/permission denied/);

    const managerDraft = crypto.randomUUID();
    const token = await issueSnapshot(users.manager, managerDraft);
    await expect(
      submitRecount(users.inventory, managerDraft, token.id, crypto.randomUUID(), 80),
    ).rejects.toThrow(/snapshot is invalid|idempotency/i);
    const hidden = await asCommit(users.inventory, (client) =>
      client.query(`select id from public.pos_imports`),
    );
    expect(hidden.rows).toHaveLength(0);
  });
});
