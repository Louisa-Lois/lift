import type { Metadata } from "next";
import { Suspense } from "react";
import { NewServiceFlow } from "@/components/new-service-flow";

export const metadata: Metadata = { title: "Deploy from GitHub · Lift" };

// useSearchParams (for ?project=) needs a Suspense boundary.
export default function NewServicePage() {
  return (
    <Suspense>
      <NewServiceFlow />
    </Suspense>
  );
}
