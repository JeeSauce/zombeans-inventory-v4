import { redirect } from "next/navigation";
import { getAuthContext, can } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseTaxConfig } from "@/lib/catalog/tax";
import { VatSettingsClient } from "@/components/admin/vat-settings-client";

export default async function SettingsPage() {
  const ctx = await getAuthContext();
  if (!can("settings.manage", ctx.permissions)) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("application_settings")
    .select("value")
    .eq("key", "vat")
    .maybeSingle();

  const vat = parseTaxConfig(data?.value);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="eyebrow text-xs">Administration</p>
        <h1 className="font-display mt-1 text-3xl">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Global configuration. VAT is disabled by default and applied only to prices with a tax
          mode once enabled.
        </p>
      </div>
      <VatSettingsClient vat={vat} />
    </div>
  );
}
