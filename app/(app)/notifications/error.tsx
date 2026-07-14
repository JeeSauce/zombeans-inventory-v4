"use client";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export default function NotificationsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>Notifications could not load</AlertTitle>
      <AlertDescription>
        No alert was acknowledged or changed. Retry the safe read.
      </AlertDescription>
      <Button variant="outline" className="mt-3" onClick={reset}>
        Try again
      </Button>
    </Alert>
  );
}
