import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let getEmailTransport: typeof import("@/lib/email").getEmailTransport;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  ({ getEmailTransport } = await import("@/lib/email"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function configure(provider: "console" | "resend" | "smtp") {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  vi.stubEnv("EMAIL_PROVIDER", provider);
  vi.stubEnv("EMAIL_FROM", "Zombeans <no-reply@zombeans.test>");
}

describe("server-only email transports", () => {
  it("allows the explicit console transport outside production", async () => {
    configure("console");
    vi.stubEnv("NODE_ENV", "test");
    const logged = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await getEmailTransport().send({ to: "staff@example.test", subject: "Code", text: "123456" });

    expect(logged).toHaveBeenCalledOnce();
  });

  it("fails closed when console delivery is selected in production", () => {
    configure("console");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getEmailTransport()).toThrow(/console is forbidden in production/i);
  });

  it("allows the explicit console transport only for loopback E2E", async () => {
    configure("console");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_ALLOW_CONSOLE_EMAIL", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    const logged = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await getEmailTransport().send({ to: "staff@example.test", subject: "Code", text: "123456" });

    expect(logged).toHaveBeenCalledOnce();

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    expect(() => getEmailTransport()).toThrow(/console is forbidden in production/i);
  });

  it("requires a Resend key and sends without exposing it in the body", async () => {
    configure("resend");
    expect(() => getEmailTransport()).toThrow(/RESEND_API_KEY is required/i);

    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getEmailTransport().send({
      to: "staff@example.test",
      subject: "Inventory alert",
      text: "Review stock",
      idempotencyKey: "notification-delivery-123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_secret",
          "Idempotency-Key": "notification-delivery-123",
        }),
        body: JSON.stringify({
          from: "Zombeans <no-reply@zombeans.test>",
          to: ["staff@example.test"],
          subject: "Inventory alert",
          text: "Review stock",
        }),
      }),
    );
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(String(request.body)).not.toContain("re_test_secret");
  });

  it("returns a sanitized provider error", async () => {
    configure("resend");
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"message":"provider detail"}', {
          status: 422,
          headers: { "x-request-id": "req_safe" },
        }),
      ),
    );

    await expect(
      getEmailTransport().send({ to: "staff@example.test", subject: "Alert", text: "Body" }),
    ).rejects.toThrow("Resend rejected email (HTTP 422, request req_safe).");
  });
});
