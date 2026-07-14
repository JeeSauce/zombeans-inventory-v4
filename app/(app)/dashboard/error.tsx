"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>Dashboard could not load</AlertTitle>
      <AlertDescription>
        No financial or operational data was exposed. Retry the safe read.
      </AlertDescription>
      <Button variant="outline" className="mt-3" onClick={reset}>
        Try again
      </Button>
    </Alert>
  );
}
