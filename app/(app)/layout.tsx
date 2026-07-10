import { getAuthContext } from "@/lib/auth/context";
import { Sidebar, MobileNav } from "@/components/app/sidebar";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { Toaster } from "@/components/ui/sonner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();

  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <Sidebar permissions={ctx.permissions} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card flex h-16 items-center justify-between gap-2 border-b px-4 md:px-6">
          <MobileNav permissions={ctx.permissions} />
          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu fullName={ctx.fullName} email={ctx.email} roleLabel={ctx.roleLabel} />
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
