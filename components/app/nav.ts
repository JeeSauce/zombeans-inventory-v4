import {
  LayoutDashboard,
  Users,
  ScrollText,
  Coffee,
  Boxes,
  Store,
  Settings,
  Truck,
  ClipboardList,
  PackageCheck,
  Undo2,
  BookOpen,
  Calculator,
  Factory,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permission required to see this item; undefined = always visible to any signed-in user. */
  permission?: string;
  /** Any matching permission reveals the item when several roles share the destination. */
  permissions?: string[];
}

/** Navigation. New sections are added as their modules land in later phases. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Products", href: "/catalog/products", icon: Coffee, permission: "catalog.item.read" },
  {
    label: "Inventory items",
    href: "/catalog/items",
    icon: Boxes,
    permission: "catalog.item.read",
  },
  {
    label: "Suppliers",
    href: "/purchasing/suppliers",
    icon: Truck,
    permission: "supplier.read",
  },
  {
    label: "Purchase orders",
    href: "/purchasing/orders",
    icon: ClipboardList,
    permission: "purchase.create",
  },
  {
    label: "Receiving",
    href: "/purchasing/receiving",
    icon: PackageCheck,
    permission: "purchase.receive",
  },
  {
    label: "Returns",
    href: "/purchasing/returns",
    icon: Undo2,
    permission: "supplier.write",
  },
  { label: "Recipes", href: "/recipes", icon: BookOpen, permission: "recipe.read" },
  { label: "Costing", href: "/costing", icon: Calculator, permission: "cost.read" },
  {
    label: "Production",
    href: "/production",
    icon: Factory,
    permissions: ["production.create", "production.record", "production.confirm"],
  },
  { label: "Users", href: "/admin/users", icon: Users, permission: "users.manage" },
  { label: "Branches", href: "/admin/branches", icon: Store, permission: "settings.manage" },
  { label: "Settings", href: "/admin/settings", icon: Settings, permission: "settings.manage" },
  { label: "Audit log", href: "/admin/audit", icon: ScrollText, permission: "audit.read" },
];

export function visibleNav(permissions: string[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      (!item.permission && !item.permissions) ||
      (item.permission ? permissions.includes(item.permission) : false) ||
      (item.permissions
        ? item.permissions.some((permission) => permissions.includes(permission))
        : false),
  );
}
