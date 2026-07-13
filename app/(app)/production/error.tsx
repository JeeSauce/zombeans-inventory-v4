"use client";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ProductionError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-3xl">Production could not be loaded</h1>
      <Alert variant="destructive">
        <AlertDescription>
          The production data is temporarily unavailable. No inventory changes were made.
        </AlertDescription>
      </Alert>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
