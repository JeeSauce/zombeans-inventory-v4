import { LoginForm } from "@/components/auth/login-form";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <div className="w-full space-y-3">
      {reason === "disabled" && (
        <Alert variant="destructive">
          <AlertDescription>
            Your account has been disabled. Contact a Super Admin.
          </AlertDescription>
        </Alert>
      )}
      <LoginForm />
    </div>
  );
}
