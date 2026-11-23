import type { Metadata } from "next";
import { Suspense } from "react";
import { CliApproval } from "@/components/cli-approval";

export const metadata: Metadata = { title: "Approve CLI login · Lift" };

// /cli-auth?code=… (FE-11), the page `lift login` opens. useSearchParams needs a Suspense boundary.
export default function CliAuthPage() {
  return (
    <Suspense>
      <CliApproval />
    </Suspense>
  );
}
