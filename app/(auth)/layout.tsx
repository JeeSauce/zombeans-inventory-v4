import { Logo } from "@/components/brand/logo";

/** Branded auth shell — always the forest-green Zombeans world (scoped `dark`). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark bg-background text-foreground relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--secondary), transparent 70%)" }}
      />
      <div className="relative flex w-full max-w-sm flex-col items-center">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size={64} glow />
          <div>
            <p className="font-display text-2xl tracking-wide">ZOMBEANS</p>
            <p className="text-muted-foreground text-xs tracking-[0.2em] uppercase">
              Inventory System
            </p>
          </div>
        </div>
        {children}
        <p className="text-muted-foreground mt-8 text-center text-xs">
          Staff access only · Rise up from the dead
        </p>
      </div>
    </div>
  );
}
