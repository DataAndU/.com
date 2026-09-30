"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMe, useUpdateRole } from "@/lib/api/account";

/**
 * No role question: every account starts in Find mode and can switch to
 * Provide at any time (Profile, or "+ Post"). This page just sets the
 * starting mode once and continues to Explore.
 */
export default function OnboardingPage() {
  const { data: user } = useMe();
  const { mutate: updateRole, isError, error } = useUpdateRole();
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (user.role) { router.replace("/home"); return; }
    if (started.current) return;
    started.current = true;
    updateRole({ role: "buyer" }, { onSuccess: () => router.replace("/home") });
  }, [user, router, updateRole]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-center">
      {isError
        ? <p role="alert" className="text-sm text-red-500">{error instanceof Error ? error.message : "Something went wrong. Please reload."}</p>
        : <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Loading" />}
    </div>
  );
}
