import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanReview } from "@/components/plan-review";

export const metadata: Metadata = { title: "Review the plan · Lift" };

// useSearchParams (for ?project=) needs a Suspense boundary.
export default async function PlanReviewPage({ params }: PageProps<"/new/plan/[planId]">) {
  const { planId } = await params;
  return (
    <Suspense>
      <PlanReview planId={planId} />
    </Suspense>
  );
}
