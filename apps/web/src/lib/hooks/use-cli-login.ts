"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Approves or denies a `lift login` code (BE-14); the answer says what became of the login. */
export function useCliLoginDecision() {
  return useMutation({
    mutationFn: ({ code, approve }: { code: string; approve: boolean }) =>
      approve ? api.cliLogins.approve(code) : api.cliLogins.deny(code),
  });
}
