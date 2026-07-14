import "server-only";
import { getServerEnv } from "@/lib/env";

/** Provider-agnostic transactional email. Dev uses the console transport; prod wires Resend/SMTP. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
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

export function getEmailTransport(): EmailTransport {
  const { EMAIL_PROVIDER } = getServerEnv();
  switch (EMAIL_PROVIDER) {
    case "console":
      return consoleTransport;
    case "resend":
    case "smtp":
      // Fail loudly until deployment selects and credentials a production adapter.
      throw new Error(`Email provider "${EMAIL_PROVIDER}" is not yet implemented`);
    default:
      return consoleTransport;
  }
}
