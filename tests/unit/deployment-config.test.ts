import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("deployment configuration", () => {
  it("pins critical runtime/framework versions and keeps Vercel output framework-owned", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines: { node: string };
    };
    expect(packageJson.engines.node).toBe("24.x");
    expect(packageJson.dependencies).toMatchObject({
      next: "15.5.20",
      react: "19.2.7",
      "react-dom": "19.2.7",
      "@supabase/ssr": "0.5.2",
      "@supabase/supabase-js": "2.110.2",
    });
    expect(packageJson.devDependencies["eslint-config-next"]).toBe("15.5.20");

    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as Record<string, unknown>;
    expect(vercel).toMatchObject({
      framework: "nextjs",
      installCommand: "npm ci",
      buildCommand: "npm run build",
    });
    expect(vercel).not.toHaveProperty("outputDirectory");
  });

  it("ships the security baseline and explicit PWA cache rules", () => {
    const source = readFileSync("next.config.mjs", "utf8");
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "strict-origin-when-cross-origin",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "camera=(self), geolocation=(), microphone=(), payment=(), usb=()",
      "Strict-Transport-Security",
      'source: "/sw.js"',
      'source: "/offline.html"',
      'source: "/manifest.webmanifest"',
      "public, max-age=0, must-revalidate",
      "public, max-age=3600, stale-while-revalidate=86400",
    ]) {
      expect(source).toContain(directive);
    }
    expect(source).toContain("poweredByHeader: false");
  });
});
