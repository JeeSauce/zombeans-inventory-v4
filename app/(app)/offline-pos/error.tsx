"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function OfflinePosError({ reset }: { reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>Offline and POS workspace could not load</AlertTitle>
      <AlertDescription>
        <p>No inventory change was attempted. Device drafts remain in this browser.</p>
        <Button className="mt-3" variant="outline" onClick={reset}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
