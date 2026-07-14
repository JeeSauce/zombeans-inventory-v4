import { formatInTimeZone } from "date-fns-tz";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { can, getAuthContext } from "@/lib/auth/context";
import { dashboardDataSchema, dashboardFinancialsSchema } from "@/lib/dashboard/data";
import { refreshOperationalNotifications } from "@/lib/notifications/refresh";
import { createClient } from "@/lib/supabase/server";
import { dashboardFilterSchema } from "@/lib/validation/phase8";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await getAuthContext();
  const params = await searchParams;
  const today = formatInTimeZone(new Date(), "Asia/Manila", "yyyy-MM-dd");
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const defaultStart = formatInTimeZone(start, "Asia/Manila", "yyyy-MM-dd");
  const parsedFilters = dashboardFilterSchema.safeParse({
    startDate: typeof params.start === "string" ? params.start : defaultStart,
    endDate: typeof params.end === "string" ? params.end : today,
    branchId: typeof params.branch === "string" ? params.branch : null,
    categoryId: typeof params.category === "string" ? params.category : null,
    itemType: typeof params.itemType === "string" ? params.itemType : null,
  });
  const filters = parsedFilters.success
    ? parsedFilters.data
    : { startDate: defaultStart, endDate: today, branchId: null, categoryId: null, itemType: null };

  let refreshError = false;
  try {
    await refreshOperationalNotifications();
  } catch (error) {
    refreshError = true;
    console.error("Dashboard notification refresh failed", error);
  }

  const supabase = await createClient();
  const [operationalResult, branchesResult, categoriesResult] = await Promise.all([
    supabase.rpc("get_dashboard_operational", {
      p_start_date: filters.startDate,
      p_end_date: filters.endDate,
      p_branch_id: filters.branchId ?? null,
      p_category_id: filters.categoryId ?? null,
      p_item_type: filters.itemType ?? null,
    }),
    supabase
      .from("branches")
      .select("id, name")
      .eq("active", true)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("categories")
      .select("id, name, item_type")
      .eq("active", true)
      .is("deleted_at", null)
      .order("name"),
  ]);
  const operational = dashboardDataSchema.safeParse(operationalResult.data);

  let financials = null;
  let financialError = false;
  if (can("cost.read", auth.permissions)) {
    const result = await supabase.rpc("get_dashboard_financials", {
      p_branch_id: filters.branchId ?? null,
      p_category_id: filters.categoryId ?? null,
      p_item_type: filters.itemType ?? null,
    });
    const parsed = dashboardFinancialsSchema.safeParse(result.data);
    financialError = Boolean(result.error || !parsed.success);
    financials = parsed.success ? parsed.data : null;
  }

  const canOpenStock = [
    "stock.in",
    "stock.out",
    "stock.transfer.prepare",
    "stock.transfer.approve",
    "stock.transfer.receive",
  ].some((permission) => can(permission, auth.permissions));

  return (
    <DashboardClient
      firstName={auth.fullName.split(" ")[0] || "there"}
      roleLabel={auth.roleLabel}
      canOpenStock={canOpenStock}
      data={operational.success ? operational.data : null}
      financials={financials}
      filters={filters}
      branches={branchesResult.data ?? []}
      categories={categoriesResult.data ?? []}
      loadError={Boolean(
        !parsedFilters.success ||
        refreshError ||
        operationalResult.error ||
        !operational.success ||
        branchesResult.error ||
        categoriesResult.error ||
        financialError,
      )}
    />
  );
}
