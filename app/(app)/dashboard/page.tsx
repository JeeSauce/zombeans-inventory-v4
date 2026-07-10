import Link from "next/link";
import { getAuthContext, can } from "@/lib/auth/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatHumanDate } from "@/lib/format";
import { ShieldCheck, KeyRound, Users, ScrollText, Lock } from "lucide-react";

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  const firstName = ctx.fullName.split(" ")[0] || "there";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <p className="eyebrow text-xs">{formatHumanDate(new Date())}</p>
        <h1 className="font-display mt-1 text-3xl">Welcome back, {firstName}</h1>
        <p className="text-muted-foreground mt-1">
          Operational modules roll out phase by phase. Access below reflects your role.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Your role</CardTitle>
            <ShieldCheck className="text-accent size-4" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">{ctx.roleLabel}</p>
            {ctx.isSuperAdmin && (
              <Badge variant="secondary" className="mt-2">
                Step-up verified
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">Permissions</CardTitle>
            <KeyRound className="text-accent size-4" />
          </CardHeader>
          <CardContent>
            <p className="font-data text-3xl">{ctx.permissions.length}</p>
            <p className="text-muted-foreground text-xs">granted capabilities</p>
          </CardContent>
        </Card>

        {/* Sensitive financial card — visible only with cost.read (Super Admin). */}
        {can("cost.read", ctx.permissions) ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                Financials
              </CardTitle>
              <Lock className="text-primary size-4" />
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                Cost, margin, and supplier-price data will surface here once catalog and costing
                land (Phases 2–4).
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {(can("users.manage", ctx.permissions) || can("audit.read", ctx.permissions)) && (
        <div className="space-y-3">
          <h2 className="eyebrow text-xs">Administration</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {can("users.manage", ctx.permissions) && (
              <QuickLink
                href="/admin/users"
                icon={<Users className="size-5" />}
                title="Users"
                desc="Create accounts, assign roles, enable or disable staff."
              />
            )}
            {can("audit.read", ctx.permissions) && (
              <QuickLink
                href="/admin/audit"
                icon={<ScrollText className="size-5" />}
                title="Audit log"
                desc="Review sign-ins, verification attempts, and changes."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="group-hover:border-primary/60 transition-colors">
        <CardContent className="flex items-start gap-4 pt-6">
          <span className="bg-secondary/60 text-accent-foreground rounded-lg p-2">{icon}</span>
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-muted-foreground text-sm">{desc}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
