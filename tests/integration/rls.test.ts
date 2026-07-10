import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { connect, createUser, assignRole, asUser, cleanupUsers } from "./helpers/db";

/**
 * RLS authorization tests against real Postgres (local Supabase).
 * Covers: permission helpers, profile visibility scoping, sensitive-table lockdown (audit,
 * email codes), and the protected-Super-Admin guards.
 *
 * Run with: `npm run test:integration` (requires `npx supabase start`).
 */

const EMAIL_LIKE = "rlstest+%@zombeans.test";
let admin: Client;
let acting: Client;

const ids = {} as { super: string; manager: string; inventory: string };

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupUsers(admin, EMAIL_LIKE);

  ids.super = await createUser(admin, "rlstest+super@zombeans.test", {
    fullName: "Super",
    isProtected: true,
  });
  ids.manager = await createUser(admin, "rlstest+manager@zombeans.test", { fullName: "Manager" });
  ids.inventory = await createUser(admin, "rlstest+inv@zombeans.test", { fullName: "Inv" });

  await assignRole(admin, ids.super, "super_admin");
  await assignRole(admin, ids.manager, "branch_manager");
  await assignRole(admin, ids.inventory, "inventory");
}, 60_000);

afterAll(async () => {
  await cleanupUsers(admin, EMAIL_LIKE);
  await admin.end();
  await acting.end();
});

describe("permission helpers", () => {
  it("super admin has cost.read; manager and inventory do not", async () => {
    const s = await admin.query(`select public.has_permission($1,'cost.read') as ok`, [ids.super]);
    const m = await admin.query(`select public.has_permission($1,'cost.read') as ok`, [
      ids.manager,
    ]);
    const i = await admin.query(`select public.has_permission($1,'cost.read') as ok`, [
      ids.inventory,
    ]);
    expect(s.rows[0].ok).toBe(true);
    expect(m.rows[0].ok).toBe(false);
    expect(i.rows[0].ok).toBe(false);
  });

  it("is_super_admin is true only for the super admin", async () => {
    const s = await admin.query(`select public.is_super_admin($1) as ok`, [ids.super]);
    const m = await admin.query(`select public.is_super_admin($1) as ok`, [ids.manager]);
    expect(s.rows[0].ok).toBe(true);
    expect(m.rows[0].ok).toBe(false);
  });

  it("inventory staff has stock.in but not price.write", async () => {
    const a = await admin.query(`select public.has_permission($1,'stock.in') as ok`, [
      ids.inventory,
    ]);
    const b = await admin.query(`select public.has_permission($1,'price.write') as ok`, [
      ids.inventory,
    ]);
    expect(a.rows[0].ok).toBe(true);
    expect(b.rows[0].ok).toBe(false);
  });
});

describe("profiles RLS", () => {
  it("a non-privileged user sees only their own profile", async () => {
    const rows = await asUser(acting, ids.inventory, async (c) => {
      const r = await c.query(`select id from public.profiles`);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(ids.inventory);
  });

  it("the super admin (users.manage) sees all profiles", async () => {
    const count = await asUser(acting, ids.super, async (c) => {
      const r = await c.query(`select count(*)::int as n from public.profiles`);
      return r.rows[0].n;
    });
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

describe("sensitive tables are locked down", () => {
  it("authenticated users cannot access email_code_challenges (no grant = hard deny)", async () => {
    // Not even the super admin can touch it via the API — only the service role/definer client.
    await expect(
      asUser(acting, ids.super, async (c) => {
        await c.query(`select count(*) from public.email_code_challenges`);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("audit_logs readable only with audit.read", async () => {
    await admin.query(
      `insert into public.audit_logs (action, entity_type, entity_id) values ('test','probe','x')`,
    );
    const superCanRead = await asUser(acting, ids.super, async (c) => {
      const r = await c.query(`select count(*)::int as n from public.audit_logs`);
      return r.rows[0].n;
    });
    const invCanRead = await asUser(acting, ids.inventory, async (c) => {
      const r = await c.query(`select count(*)::int as n from public.audit_logs`);
      return r.rows[0].n;
    });
    expect(superCanRead).toBeGreaterThanOrEqual(1);
    expect(invCanRead).toBe(0);
  });

  it("audit_logs cannot be updated or deleted through the API (append-only)", async () => {
    await expect(
      asUser(acting, ids.super, async (c) => {
        await c.query(`delete from public.audit_logs where entity_type = 'probe'`);
      }),
    ).rejects.toThrow();
  });
});

describe("protected Super Admin guards", () => {
  it("cannot be disabled", async () => {
    await expect(
      admin.query(`update public.profiles set status='disabled' where id=$1`, [ids.super]),
    ).rejects.toThrow(/cannot be disabled/i);
  });

  it("cannot be deleted", async () => {
    await expect(
      admin.query(`delete from public.profiles where id=$1`, [ids.super]),
    ).rejects.toThrow(/cannot be deleted/i);
  });

  it("cannot have the super_admin role removed", async () => {
    await expect(
      admin.query(
        `delete from public.user_roles ur using public.roles r
         where ur.role_id=r.id and r.key='super_admin' and ur.profile_id=$1`,
        [ids.super],
      ),
    ).rejects.toThrow(/cannot remove the super_admin role/i);
  });
});
