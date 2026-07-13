"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function DailyOpsError({ reset }: { reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>Daily operations could not load</AlertTitle>
      <AlertDescription>
        <p>
          No inventory change was attempted. Retry after checking the local database connection.
        </p>
        <Button className="mt-3" variant="outline" onClick={reset}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
