"use client";

import { isLiftApiError } from "@lift/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { type ReactNode, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Inlined at build time. Production builds never set it, so the mocks never run there.
const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "1";

// Browser only: Mock Service Worker has no server build.
const MocksGate = dynamic(() => import("@/mocks/mocks-gate"), { ssr: false });

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // An answer from the API (401, 404, 409…) won't change on retry; a network blip might.
        retry: (failureCount, error) =>
          !(isLiftApiError(error) && error.status < 500) && failureCount < 2,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(newQueryClient);
  const app = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return USE_MOCKS ? <MocksGate>{app}</MocksGate> : app;
}
