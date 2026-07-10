import { redirect } from "next/navigation";

/** Middleware routes "/" based on auth; this is a fallback. */
export default function RootPage() {
  redirect("/dashboard");
}
