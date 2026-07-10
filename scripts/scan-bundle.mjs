// Critical scenario #23: the Supabase service-role key must never appear in the client bundle.
// Scans .next/static after a build for the configured service-role key. Exits non-zero on a hit.
// Run: npm run scan:bundle   (requires a prior `next build`)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = ".next/static";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!key) {
  console.log("scan:bundle — SUPABASE_SERVICE_ROLE_KEY not set; nothing to scan for. Skipping.");
  process.exit(0);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(DIR);
} catch {
  console.error(`scan:bundle — ${DIR} not found. Run \`next build\` first.`);
  process.exit(1);
}

const hits = files.filter((f) => readFileSync(f, "utf8").includes(key));

if (hits.length) {
  console.error("scan:bundle — FAIL: service-role key found in client bundle:");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log(
  `scan:bundle — PASS: service-role key absent from ${files.length} client bundle files.`,
);
