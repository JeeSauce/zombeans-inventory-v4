import { z } from "zod";

/**
 * Fail-fast environment validation.
 *
 * `clientEnv` contains ONLY `NEXT_PUBLIC_*` values and is safe to reference in the
 * browser. `serverEnv` is lazily validated and MUST never be imported from a client
 * component — importing this file's `serverEnv` in a "use client" module is a bug.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  EMAIL_PROVIDER: z.enum(["console", "resend", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("Zombeans <no-reply@zombeans.xyz>"),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  STEPUP_CODE_PEPPER: z.string().min(8).default("local-dev-stepup-pepper-change-me"),
  STEPUP_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  STEPUP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  STEPUP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  APP_TIMEZONE: z.string().default("Asia/Manila"),
  APP_DEFAULT_CURRENCY: z.string().default("PHP"),
  LOYVERSE_API_TOKEN: z.string().optional(),
});

function format(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

export const clientEnv = (() => {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!parsed.success) {
    throw new Error(`Invalid public environment variables:\n${format(parsed.error)}`);
  }
  return parsed.data;
})();

/**
 * Validated server-only environment. Call from server code only.
 * Throws if referenced without the required secrets present.
 */
export function getServerEnv() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment variables:\n${format(parsed.error)}`);
  }
  return parsed.data;
}
