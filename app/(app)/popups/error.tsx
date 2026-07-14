"use client";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export default function PopupsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>Popup events could not load</AlertTitle>
      <AlertDescription>
        No inventory or engagement state was changed. Retry the safe read.
      </AlertDescription>
      <Button className="mt-3" variant="outline" onClick={reset}>
        Try again
      </Button>
    </Alert>
  );
}
