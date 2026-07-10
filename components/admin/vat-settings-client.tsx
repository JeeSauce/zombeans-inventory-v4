"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { updateVatAction, type SettingsActionState } from "@/app/(app)/admin/settings/actions";
import { computeLineTax, type TaxConfig } from "@/lib/catalog/tax";
import { formatPeso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save VAT settings"}
    </Button>
  );
}

export function VatSettingsClient({ vat }: { vat: TaxConfig }) {
  const [state, formAction] = useActionState<SettingsActionState, FormData>(updateVatAction, {});
  const [enabled, setEnabled] = useState(vat.enabled);
  const [rate, setRate] = useState(String(vat.rate));

  useEffect(() => {
    if (state.info) toast.success(state.info);
  }, [state]);

  const cfg: TaxConfig = { enabled, rate: Number(rate) || 0 };
  const sample = computeLineTax(100, "exclusive", cfg);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Value-Added Tax (VAT)
          <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "On" : "Off"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-primary size-4"
            />
            <span>
              <span className="font-medium">Enable VAT</span>
              <span className="text-muted-foreground block text-xs">
                When off, tax is never added — regardless of a price&apos;s tax mode.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rate">Rate (fraction)</Label>
              <Input
                id="rate"
                name="rate"
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="font-data"
              />
              <p className="text-muted-foreground text-xs">
                {(Number(rate) * 100 || 0).toFixed(2)}% — e.g. 0.12 for the 12% PH rate.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="registeredName">Registered name (optional)</Label>
              <Input
                id="registeredName"
                name="registeredName"
                defaultValue={vat.registeredName ?? ""}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tin">TIN (optional)</Label>
            <Input
              id="tin"
              name="tin"
              defaultValue={vat.tin ?? ""}
              className="font-data max-w-xs"
              placeholder="000-000-000-000"
            />
          </div>

          <div className="bg-secondary/40 rounded-md border p-3 text-sm">
            <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
              Preview — a {formatPeso(100)} tax-exclusive price
            </p>
            {sample.applied ? (
              <p className="font-data">
                Net {formatPeso(sample.net)} + VAT {formatPeso(sample.tax)} ={" "}
                <span className="font-semibold">{formatPeso(sample.gross)}</span>
              </p>
            ) : (
              <p className="font-data">
                No tax applied — customer pays{" "}
                <span className="font-semibold">{formatPeso(100)}</span>
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Save />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
