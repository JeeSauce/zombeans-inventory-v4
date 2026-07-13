import Link from "next/link";
import { redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatHumanDate } from "@/lib/format";
import { statusBadgeVariant, type PoStatus } from "@/lib/purchasing/po-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ReceivableOrder {
  id: string;
  reference: string;
  status: PoStatus;
  expectedDate: string | null;
  supplierName: string;
}

export default async function ReceivingPage() {
  const ctx = await getAuthContext();
  if (!can("purchase.receive", ctx.permissions)) redirect("/dashboard");

  const supabase = await createClient();

  type RawOrder = {
    id: string;
    reference: string;
    status: string;
    expected_date: string | null;
    supplier: { name: string } | null;
  };

  const { data, error } = await supabase
    .from("purchase_orders")
    .select("id, reference, status, expected_date, supplier:suppliers(name)")
    .is("deleted_at", null)
    .in("status", ["approved", "partially_received"])
    .order("expected_date", { ascending: true, nullsFirst: false });

  const orders: ReceivableOrder[] = ((data as RawOrder[] | null) ?? []).map((o) => ({
    id: o.id,
    reference: o.reference,
    status: o.status as PoStatus,
    expectedDate: o.expected_date,
    supplierName: o.supplier?.name ?? "—",
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Purchasing</p>
        <h1 className="font-display mt-1 text-3xl">Receiving</h1>
        <p className="text-muted-foreground mt-1">
          Approved purchase orders waiting to be received. Record what actually arrived — cost and
          pricing information is never shown here.
        </p>
      </div>

      {error ? (
        <div className="text-destructive rounded-lg border border-dashed p-10 text-center">
          Could not load orders to receive. Try refreshing the page.
        </div>
      ) : orders.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          Nothing waiting to be received right now. Approved purchase orders will show up here.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-data font-medium">{o.reference}</TableCell>
                  <TableCell>{o.supplierName}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(o.status)}>
                      {o.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {o.expectedDate ? formatHumanDate(o.expectedDate) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/purchasing/receiving/${o.id}`}>
                        <PackageCheck className="size-4" /> Receive
                      </Link>
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
