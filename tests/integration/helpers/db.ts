import { Client } from "pg";

/**
 * Direct Postgres connection to the local Supabase DB. RLS is tested faithfully by switching to
 * the non-superuser `authenticated` role and setting the JWT-claims GUC that Supabase's
 * `auth.uid()` reads — exactly how Postgres enforces policies for a signed-in user.
 */
export const LOCAL_DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  return client;
}

/** Create a Supabase auth user (the trigger creates the matching profile). Returns the user id. */
export async function createUser(
  admin: Client,
  email: string,
  opts: { fullName?: string; isProtected?: boolean } = {},
): Promise<string> {
  const meta = JSON.stringify({
    full_name: opts.fullName ?? email.split("@")[0],
    is_protected: opts.isProtected ?? false,
  });
  const { rows } = await admin.query(
    `insert into auth.users
       (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at, raw_user_meta_data)
     values
       ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
        'authenticated', $1, extensions.crypt('password123', extensions.gen_salt('bf')),
        now(), now(), now(), $2::jsonb)
     returning id`,
    [email, meta],
  );
  return rows[0].id as string;
}

/** Assign a system role (by key) to a profile. */
export async function assignRole(admin: Client, profileId: string, roleKey: string): Promise<void> {
  await admin.query(
    `insert into public.user_roles (profile_id, role_id)
     select $1, r.id from public.roles r where r.key = $2
     on conflict do nothing`,
    [profileId, roleKey],
  );
}

/**
 * Run a callback as a given authenticated user, with RLS enforced. Everything happens inside a
 * transaction that is rolled back, so tests never mutate shared state.
 */
export async function asUser<T>(
  client: Client,
  userId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

/**
 * Remove all test users (cascades to profiles/user_roles). Disables USER triggers around the
 * delete so the protected-Super-Admin guard doesn't block teardown; FK cascades (system triggers)
 * still fire. Requires table ownership — the admin connection is the `postgres` superuser.
 */
export async function cleanupUsers(admin: Client, emailLike: string): Promise<void> {
  await admin.query(`alter table public.profiles disable trigger user`);
  await admin.query(`alter table public.user_roles disable trigger user`);
  try {
    await admin.query(`delete from auth.users where email like $1`, [emailLike]);
  } finally {
    await admin.query(`alter table public.profiles enable trigger user`);
    await admin.query(`alter table public.user_roles enable trigger user`);
  }
}
