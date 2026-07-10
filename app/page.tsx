/**
 * Phase 0 placeholder landing. Real routes (auth, dashboard, modules) arrive in Phase 1+.
 * This exists only so the scaffold builds and renders; it carries no business logic.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="rounded-full border px-3 py-1 text-xs font-medium tracking-wide text-[var(--muted-foreground)] uppercase">
        Phase 0 · Foundation
      </span>
      <h1 className="text-4xl font-semibold">Zombeans Inventory</h1>
      <p className="text-[var(--muted-foreground)]">
        Multi-branch inventory management. Scaffold is in place — authentication, roles, and the
        inventory ledger arrive in the next phases.
      </p>
      <a
        href="https://github.com"
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-foreground)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
      >
        See docs/IMPLEMENTATION_PHASES.md
      </a>
    </main>
  );
}
