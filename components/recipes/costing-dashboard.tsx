import Link from "next/link";
import { formatPeso } from "@/lib/format";
import type { SellingMetrics } from "@/lib/recipes/costing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface CostingRow {
  id: string;
  recipeId: string;
  recipeName: string;
  kind: "production" | "sale" | "modifier";
  targetLabel: string;
  branchName: string;
  ingredientCost: number;
  packagingCost: number;
  wasteCost: number;
  unitCost: number;
  sellingPrice: number | null;
  metrics: SellingMetrics | null;
}

function percent(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}

export function CostingDashboard({ rows, errors }: { rows: CostingRow[]; errors: string[] }) {
  const pricedRows = rows.filter((row) => row.sellingPrice !== null && row.metrics !== null);
  const recipeCount = new Set(rows.map((row) => row.recipeId)).size;
  const averageFoodCost =
    pricedRows.length > 0
      ? pricedRows.reduce((sum, row) => sum + (row.metrics?.foodCostPct ?? 0), 0) /
        pricedRows.length
      : null;

  return (
    <div className="space-y-5">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            {errors.length} active {errors.length === 1 ? "recipe" : "recipes"} could not be costed:{" "}
            {errors.join("; ")}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="gap-2 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Active recipes costed
            </CardTitle>
          </CardHeader>
          <CardContent className="font-data px-5 text-3xl font-semibold">{recipeCount}</CardContent>
        </Card>
        <Card className="gap-2 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Priced branch targets
            </CardTitle>
          </CardHeader>
          <CardContent className="font-data px-5 text-3xl font-semibold">
            {pricedRows.length}
          </CardContent>
        </Card>
        <Card className="gap-2 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Average food cost
            </CardTitle>
          </CardHeader>
          <CardContent className="font-data px-5 text-3xl font-semibold">
            {averageFoodCost === null ? "—" : `${averageFoodCost.toFixed(2)}%`}
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          Activate a recipe version to populate the costing dashboard.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipe</TableHead>
                <TableHead>Branch / scope</TableHead>
                <TableHead className="text-right">Ingredients</TableHead>
                <TableHead className="text-right">Packaging</TableHead>
                <TableHead className="text-right">Waste</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Selling price</TableHead>
                <TableHead className="text-right">Gross profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Food cost</TableHead>
                <TableHead className="text-right">Markup</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.recipeName}</div>
                    <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                      <Badge variant="outline">{row.kind}</Badge>
                      <span>{row.targetLabel}</span>
                    </div>
                  </TableCell>
                  <TableCell>{row.branchName}</TableCell>
                  <TableCell className="font-data text-right">
                    {formatPeso(row.ingredientCost)}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {formatPeso(row.packagingCost)}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {formatPeso(row.wasteCost)}
                  </TableCell>
                  <TableCell className="font-data text-right font-medium">
                    {formatPeso(row.unitCost)}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {row.sellingPrice === null ? "—" : formatPeso(row.sellingPrice)}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {row.metrics ? formatPeso(row.metrics.grossProfit) : "—"}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {percent(row.metrics?.grossMarginPct)}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {percent(row.metrics?.foodCostPct)}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {percent(row.metrics?.markupPct)}
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/recipes/${row.recipeId}`}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
