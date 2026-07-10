"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  verifyStepUpAction,
  resendStepUpAction,
  signOutAction,
  type ActionState,
} from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Verifying…" : "Verify & continue"}
    </Button>
  );
}

export function VerifyForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(verifyStepUpAction, {});
  const [resend, setResend] = useState<ActionState>({});
  const [isResending, startResend] = useTransition();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">Verify it&apos;s you</CardTitle>
        <p className="text-muted-foreground text-sm">
          We emailed a 6-digit code to your Super Admin address. It expires in about 5 minutes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {resend.info && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertDescription>{resend.info}</AlertDescription>
            </Alert>
          )}
          {resend.error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{resend.error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="font-data text-center text-2xl tracking-[0.5em]"
              required
            />
          </div>
          <SubmitButton />
        </form>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={isResending}
            onClick={() => startResend(async () => setResend(await resendStepUpAction()))}
            className="text-primary underline-offset-4 hover:underline disabled:opacity-50"
          >
            {isResending ? "Sending…" : "Resend code"}
          </button>
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              Cancel
            </button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
