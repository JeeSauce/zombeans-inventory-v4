import { LayoutDashboard, Users, ScrollText, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permission required to see this item; undefined = always visible to any signed-in user. */
  permission?: string;
}

/** Phase 1 navigation. New sections are added as their modules land in later phases. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users, permission: "users.manage" },
  { label: "Audit log", href: "/admin/audit", icon: ScrollText, permission: "audit.read" },
];

export function visibleNav(permissions: string[]): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.permission || permissions.includes(i.permission));
}
