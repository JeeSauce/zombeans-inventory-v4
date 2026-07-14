"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ReportDetailError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="p-6">
      <div className="border-destructive/40 bg-destructive/5 max-w-xl rounded-xl border p-6">
        <h1 className="font-heading text-xl font-semibold">This report could not be generated</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          No export was created and no inventory data changed. Check the filters or try again.
        </p>
        <div className="mt-4 flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/reports">All reports</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
