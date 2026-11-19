"use client";

import { type ReactNode, useEffect, useState } from "react";
import { startMocks } from "./browser";

/**
 * Renders its children once Mock Service Worker answers requests. Loaded only in the browser
 * (next/dynamic with ssr: false), because msw/browser has no server build.
 */
export default function MocksGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    startMocks().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready ? children : null;
}
