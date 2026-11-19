import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "./login-screen";

export const metadata: Metadata = { title: "Sign in · Lift" };

// useSearchParams needs a Suspense boundary, or the static build of this page fails.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
