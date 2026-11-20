"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** Monaco touches the browser as it loads, so the pane never renders on the server. */
export const LazyMonacoPane = dynamic(() => import("./monaco-pane"), {
  ssr: false,
  loading: () => <Skeleton className="absolute inset-0 rounded-none" />,
});
