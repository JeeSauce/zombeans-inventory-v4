import "server-only";
import { getServerEnv } from "@/lib/env";

/** Provider-agnostic transactional email. Dev uses console; production uses Resend. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey?: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

const consoleTransport: EmailTransport = {
  async send({ to, subject, text }) {
    // Never logged in production (EMAIL_PROVIDER !== "console"). Dev-only visibility.
    console.info(`\n[email:console] to=${to}\nsubject=${subject}\n${text}\n`);
  },
};

function createResendTransport(apiKey: string, from: string): EmailTransport {
  return {
    async send({ to, subject, text, idempotencyKey }) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!response.ok) {
        const requestId = response.headers.get("x-request-id");
        throw new Error(
          `Resend rejected email (HTTP ${response.status}${requestId ? `, request ${requestId}` : ""}).`,
        );
      }
    },
  };
}

function allowsLocalE2EConsole(): boolean {
  if (process.env.E2E_ALLOW_CONSOLE_EMAIL !== "true") return false;
  try {
    const hostname = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function getEmailTransport(): EmailTransport {
  const { EMAIL_PROVIDER, EMAIL_FROM, RESEND_API_KEY } = getServerEnv();
  switch (EMAIL_PROVIDER) {
    case "console": {
      if (process.env.NODE_ENV === "production" && !allowsLocalE2EConsole()) {
        throw new Error("EMAIL_PROVIDER=console is forbidden in production");
      }
      return consoleTransport;
    }
    case "resend": {
      if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is required for EMAIL_PROVIDER=resend");
      return createResendTransport(RESEND_API_KEY, EMAIL_FROM);
    }
    case "smtp":
      throw new Error("EMAIL_PROVIDER=smtp is not implemented; use Resend for production");
  }
}
