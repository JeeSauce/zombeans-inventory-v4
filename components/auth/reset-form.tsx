"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { resetRequestAction, type ActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2 } from "lucide-react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Send reset link"}
    </Button>
  );
}

export function ResetForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(resetRequestAction, {});
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">Reset password</CardTitle>
        <p className="text-muted-foreground text-sm">
          Enter your work email and we&apos;ll send a reset link.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state.info && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertDescription>{state.info}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <SubmitButton />
          <Link
            href="/login"
            className="text-muted-foreground block text-center text-sm underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
