import { z } from "zod";

const number = z.coerce.number().finite();
const nullableText = z.string().nullable();

export const dashboardDataSchema = z.object({
  filters: z.object({
    start_date: z.string(),
    end_date: z.string(),
    branch_id: z.string().uuid().nullable(),
    category_id: z.string().uuid().nullable(),
    item_type: z.string().nullable(),
  }),
  summary: z.object({
    low_stock_count: z.coerce.number().int().nonnegative(),
    out_of_stock_count: z.coerce.number().int().nonnegative(),
    negative_inventory_count: z.coerce.number().int().nonnegative(),
    todays_production_count: z.coerce.number().int().nonnegative(),
    pending_request_count: z.coerce.number().int().nonnegative(),
    failed_production_count: z.coerce.number().int().nonnegative(),
    recount_variance_count: z.coerce.number().int().nonnegative(),
    upcoming_event_count: z.coerce.number().int().nonnegative(),
  }),
  branch_stock_levels: z.array(
    z.object({
      branch_name: z.string(),
      tracked_items: z.coerce.number().int().nonnegative(),
      out_of_stock_items: z.coerce.number().int().nonnegative(),
      negative_items: z.coerce.number().int().nonnegative(),
    }),
  ),
  most_used_ingredients: z.array(
    z.object({
      item_name: z.string(),
      sku: z.string(),
      unit_code: z.string(),
      total_used: number,
    }),
  ),
  recent_movements: z.array(
    z.object({
      reference: z.string(),
      type: z.string(),
      branch_name: z.string(),
      item_name: z.string(),
      sku: z.string(),
      quantity: number,
      unit_code: z.string(),
      created_at: z.string(),
    }),
  ),
  negative_inventory: z.array(
    z.object({
      item_name: z.string(),
      sku: z.string(),
      branch_name: z.string(),
      quantity: number,
      reason: z.string(),
      created_at: z.string(),
    }),
  ),
  failed_production: z.array(
    z.object({
      reference: z.string(),
      branch_name: z.string(),
      output_name: z.string(),
      output_sku: z.string(),
      failed_at: z.string(),
    }),
  ),
  recount_variances: z.array(
    z.object({
      reference: z.string(),
      branch_name: z.string(),
      type: z.string(),
      is_unusual: z.boolean(),
      submitted_at: z.string(),
    }),
  ),
  upcoming_events: z.array(
    z.object({
      reference: z.string(),
      title: z.string(),
      event_type: z.string(),
      branch_name: nullableText,
      location: nullableText,
      starts_at: z.string(),
      ends_at: z.string(),
    }),
  ),
});

export const dashboardFinancialsSchema = z.object({
  inventory_value: number,
  valued_item_count: z.coerce.number().int().nonnegative(),
});

export type DashboardData = z.infer<typeof dashboardDataSchema>;
export type DashboardFinancials = z.infer<typeof dashboardFinancialsSchema>;
