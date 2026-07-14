"use client";

import { Button } from "@/components/ui/button";

export default function ReportsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="p-6">
      <div className="border-destructive/40 bg-destructive/5 max-w-xl rounded-xl border p-6">
        <h1 className="font-heading text-xl font-semibold">Reports could not be loaded</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Your permissions and report data remain unchanged. Try loading the page again.
        </p>
        <Button className="mt-4" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
