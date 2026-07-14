import { getAuthContext } from "@/lib/auth/context";
import { Sidebar, MobileNav } from "@/components/app/sidebar";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/app/service-worker-register";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();

  return (
    <div className="bg-background text-foreground flex min-h-screen">
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground focus:ring-ring sr-only z-50 rounded-md px-4 py-3 font-medium shadow-lg focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:ring-2 focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <Sidebar permissions={ctx.permissions} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card flex h-16 items-center justify-between gap-2 border-b px-4 md:px-6">
          <MobileNav permissions={ctx.permissions} />
          <div className="flex-1" />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu fullName={ctx.fullName} email={ctx.email} roleLabel={ctx.roleLabel} />
        </header>
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
      <Toaster />
      <ServiceWorkerRegister />
    </div>
  );
}
