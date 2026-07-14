"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  Factory,
  PackageX,
  Scale,
  TrendingDown,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardData, DashboardFinancials } from "@/lib/dashboard/data";
import { formatHumanDate, formatHumanDateTime, formatPeso } from "@/lib/format";
import { ITEM_TYPES, type DashboardFilters } from "@/lib/validation/phase8";

function KpiCard({
  title,
  value,
  hint,
  icon,
  critical = false,
}: {
  title: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
  critical?: boolean;
}) {
  return (
    <Card className={critical ? "border-destructive/60" : undefined}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
        <span className={critical ? "text-destructive" : "text-accent"}>{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="font-data text-3xl font-semibold">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardClient({
  firstName,
  data,
  financials,
  filters,
  branches,
  categories,
  loadError,
}: {
  firstName: string;
  data: DashboardData | null;
  financials: DashboardFinancials | null;
  filters: DashboardFilters;
  branches: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; item_type: string }>;
  loadError: boolean;
}) {
  const empty =
    data !== null &&
    data.branch_stock_levels.length === 0 &&
    data.recent_movements.length === 0 &&
    data.upcoming_events.length === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="eyebrow text-xs">{formatHumanDate(new Date())}</p>
        <h1 className="font-display mt-1 text-3xl">Welcome back, {firstName}</h1>
        <p className="text-muted-foreground mt-1">
          Role-filtered operations, alerts, movement, and upcoming work.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dashboard filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
            <label className="space-y-1 text-sm">
              <span>Start date</span>
              <input
                className="border-input bg-background h-9 w-full rounded-md border px-3"
                type="date"
                name="start"
                defaultValue={filters.startDate}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>End date</span>
              <input
                className="border-input bg-background h-9 w-full rounded-md border px-3"
                type="date"
                name="end"
                defaultValue={filters.endDate}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Branch</span>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-3"
                name="branch"
                defaultValue={filters.branchId ?? ""}
              >
                <option value="">All accessible branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Category</span>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-3"
                name="category"
                defaultValue={filters.categoryId ?? ""}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Item type</span>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-3"
                name="itemType"
                defaultValue={filters.itemType ?? ""}
              >
                <option value="">All item types</option>
                {ITEM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <Button className="sm:col-span-2 lg:col-span-5 lg:justify-self-end" type="submit">
              Apply filters
            </Button>
          </form>
        </CardContent>
      </Card>

      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Some dashboard data could not refresh</AlertTitle>
          <AlertDescription>
            Existing safe results are shown where available. Retry the page for current alerts and
            email delivery.
          </AlertDescription>
        </Alert>
      )}
      {empty && (
        <Alert>
          <Boxes className="size-4" />
          <AlertTitle>No activity in this filter range</AlertTitle>
          <AlertDescription>
            Choose a wider range or another branch. KPI cards remain at zero.
          </AlertDescription>
        </Alert>
      )}
      {data?.summary.negative_inventory_count ? (
        <Alert variant="destructive" className="border-destructive/70">
          <AlertTriangle className="size-4" />
          <AlertTitle>Critical negative inventory is active</AlertTitle>
          <AlertDescription>
            {data.summary.negative_inventory_count} item balance
            {data.summary.negative_inventory_count === 1 ? "" : "s"} require immediate
            investigation.{" "}
            <Link className="underline" href="/stock">
              Open stock
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {financials && (
              <KpiCard
                title="Total inventory value"
                value={formatPeso(financials.inventory_value)}
                hint={`${financials.valued_item_count} valued balance rows · Super Admin only`}
                icon={<CircleDollarSign className="size-4" />}
              />
            )}
            <KpiCard
              title="Low stock"
              value={data.summary.low_stock_count}
              hint="Above zero, below operating level"
              icon={<TrendingDown className="size-4" />}
            />
            <KpiCard
              title="Out of stock"
              value={data.summary.out_of_stock_count}
              hint="Tracked balances at zero"
              icon={<PackageX className="size-4" />}
            />
            <KpiCard
              title="Today's production"
              value={data.summary.todays_production_count}
              hint="Completed in Asia/Manila today"
              icon={<Factory className="size-4" />}
            />
            <KpiCard
              title="Pending requests"
              value={data.summary.pending_request_count}
              hint="Requested or approved"
              icon={<ClipboardList className="size-4" />}
            />
            <KpiCard
              title="Critical negative"
              value={data.summary.negative_inventory_count}
              hint="Never hidden by acknowledgement"
              icon={<AlertTriangle className="size-4" />}
              critical={data.summary.negative_inventory_count > 0}
            />
            <KpiCard
              title="Failed production"
              value={data.summary.failed_production_count}
              hint="In the selected range"
              icon={<Factory className="size-4" />}
              critical={data.summary.failed_production_count > 0}
            />
            <KpiCard
              title="Recount variances"
              value={data.summary.recount_variance_count}
              hint="Submitted or adjusted in range"
              icon={<Scale className="size-4" />}
            />
            <KpiCard
              title="Upcoming events"
              value={data.summary.upcoming_event_count}
              hint="Next 30 days"
              icon={<CalendarDays className="size-4" />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Branch stock levels</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.branch_stock_levels.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No branch balances match.</p>
                ) : (
                  data.branch_stock_levels.map((branch) => (
                    <div
                      key={branch.branch_name}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div>
                        <p className="font-medium">{branch.branch_name}</p>
                        <p className="text-muted-foreground text-xs">
                          {branch.tracked_items} tracked item balances
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="outline">{branch.out_of_stock_items} out</Badge>
                        {branch.negative_items > 0 && (
                          <Badge variant="destructive">{branch.negative_items} negative</Badge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Most-used ingredients</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.most_used_ingredients.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No ingredient usage in this range.
                  </p>
                ) : (
                  data.most_used_ingredients.map((item) => (
                    <div
                      key={`${item.sku}-${item.unit_code}`}
                      className="flex justify-between gap-3 border-b pb-2 last:border-0"
                    >
                      <div>
                        <p className="font-medium">{item.item_name}</p>
                        <p className="font-data text-muted-foreground text-xs">{item.sku}</p>
                      </div>
                      <span className="font-data">
                        {item.total_used} {item.unit_code}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Recent movements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.recent_movements.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No posted movements in this range.
                  </p>
                ) : (
                  data.recent_movements.map((movement, index) => (
                    <div
                      key={`${movement.reference}-${movement.sku}-${index}`}
                      className="grid gap-1 rounded-lg border p-3 sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <p className="font-medium">
                          {movement.item_name}{" "}
                          <span className="font-data text-xs">{movement.sku}</span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {movement.reference} · {movement.type.replaceAll("_", " ")} ·{" "}
                          {movement.branch_name}
                        </p>
                      </div>
                      <div className="sm:text-right">
                        <p className="font-data">
                          {movement.quantity} {movement.unit_code}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatHumanDateTime(movement.created_at)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Upcoming events</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.upcoming_events.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No upcoming calendar work.</p>
                ) : (
                  data.upcoming_events.map((event) => (
                    <Link
                      key={event.reference}
                      href="/calendar"
                      className="hover:border-primary/60 block rounded-lg border p-3"
                    >
                      <p className="font-medium">{event.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {event.reference} · {event.branch_name ?? "All branches"}
                      </p>
                      <p className="mt-1 text-sm">{formatHumanDateTime(event.starts_at)}</p>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
