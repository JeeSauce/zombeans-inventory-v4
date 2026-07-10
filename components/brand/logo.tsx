import Image from "next/image";
import { cn } from "@/lib/utils";

/** Zombeans coffee-brain mark. `glow` adds the signature zombie-green halo (brand moments only). */
export function Logo({
  size = 40,
  glow = false,
  className,
}: {
  size?: number;
  glow?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center justify-center", className)}
      style={
        glow
          ? {
              filter:
                "drop-shadow(0 0 22px color-mix(in srgb, var(--brand-glow) 45%, transparent))",
            }
          : undefined
      }
    >
      <Image src="/brand/logo.png" alt="Zombeans" width={size} height={size} priority />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Logo size={30} />
      <span className="font-display text-xl tracking-wide">ZOMBEANS</span>
    </span>
  );
}
