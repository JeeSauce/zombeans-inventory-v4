"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { visibleNav, type NavItem } from "@/components/app/nav";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}

/** Desktop sidebar (md+). */
export function Sidebar({ permissions }: { permissions: string[] }) {
  const isActive = useActive();
  const items = visibleNav(permissions);
  return (
    <aside className="bg-card hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="flex h-16 items-center border-b px-5">
        <Link href="/dashboard">
          <Wordmark />
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </nav>
      <div className="text-muted-foreground border-t p-4 text-xs">
        <span className="eyebrow text-[0.65rem]">Phase 9</span>
        <p className="mt-1">Reports, protected exports, retention, and recovery controls.</p>
      </div>
    </aside>
  );
}

/** Mobile nav trigger (shown in the top bar on small screens). */
export function MobileNav({ permissions }: { permissions: string[] }) {
  const isActive = useActive();
  const items = visibleNav(permissions);
  return (
    <div className="md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem key={item.href} asChild>
                <Link
                  href={item.href}
                  className={cn("flex items-center gap-2", isActive(item.href) && "text-primary")}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
