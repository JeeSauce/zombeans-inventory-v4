// Development seed — creates the Super Admin and one user per role via the Supabase admin API.
// Run: npm run seed:dev   (loads .env.local via --env-file)
// SAFETY: refuses to run against a non-local Supabase URL. Never seed accounts into production.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error(`Refusing to seed dev accounts into a non-local target: ${url}`);
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/** [DEV DATA] accounts. Password is the same for all local test users. */
const PASSWORD = "Zombeans!Dev123";
const USERS = [
  {
    email: "superadmin@zombeans.dev",
    fullName: "Zombeans Super Admin",
    role: "super_admin",
    protected: true,
  },
  {
    email: "manager@zombeans.dev",
    fullName: "Branch Manager",
    role: "branch_manager",
    protected: false,
  },
  {
    email: "production@zombeans.dev",
    fullName: "Production Staff",
    role: "production",
    protected: false,
  },
  {
    email: "inventory@zombeans.dev",
    fullName: "Inventory Staff",
    role: "inventory",
    protected: false,
  },
];

async function findUserByEmail(email) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data.users.find((u) => u.email === email) ?? null;
}

async function upsertUser(u) {
  let user = await findUserByEmail(u.email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.fullName, is_protected: u.protected },
    });
    if (error) throw error;
    user = data.user;
    console.log(`created ${u.email}`);
  } else {
    console.log(`exists  ${u.email}`);
  }

  const { data: role, error: roleErr } = await admin
    .from("roles")
    .select("id")
    .eq("key", u.role)
    .single();
  if (roleErr) throw roleErr;

  const { error: urErr } = await admin
    .from("user_roles")
    .upsert({ profile_id: user.id, role_id: role.id }, { onConflict: "profile_id,role_id" });
  if (urErr) throw urErr;
  return user.id;
}

const seededUserIds = new Map();
for (const u of USERS) {
  seededUserIds.set(u.role, await upsertUser(u));
}

const { data: branches, error: branchErr } = await admin
  .from("branches")
  .select("id")
  .eq("active", true)
  .is("deleted_at", null);
if (branchErr) throw branchErr;
const assignedBy = seededUserIds.get("super_admin");
const assignments = ["production", "inventory"].flatMap((role) =>
  (branches ?? []).map((branch) => ({
    profile_id: seededUserIds.get(role),
    branch_id: branch.id,
    assigned_by: assignedBy,
  })),
);
if (assignments.length > 0) {
  const { error: assignmentErr } = await admin
    .from("user_branch_assignments")
    .upsert(assignments, { onConflict: "profile_id,branch_id" });
  if (assignmentErr) throw assignmentErr;
}
console.log(`\nDone. Log in with any of the above and password: ${PASSWORD}`);
console.log(
  "Super Admin login also requires the emailed 6-digit step-up code (console transport).",
);
