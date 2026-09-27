"use client";

import { useMe } from "@/lib/api/account";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * UX-only onboarding redirect. It is NOT a security boundary: the Next
 * middleware requires a Clerk session for every (app) route and the API
 * re-verifies the session, suspension and role on every request.
 *
 * Children render immediately so page data requests start in parallel with
 * /api/me instead of waiting behind a full-page spinner. Only an account that
 * is confirmed to have no role yet is held back while it is sent to onboarding.
 */
export function RoleGuard({ children }: { children: React.ReactNode }) {
  const { data: user } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const needsOnboarding = !!user && !user.role && pathname !== "/onboarding";

  useEffect(() => {
    if (needsOnboarding) router.replace("/onboarding");
  }, [needsOnboarding, router]);

  if (needsOnboarding) {
    return <div className="flex-1 flex items-center justify-center bg-background"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  }

  return <>{children}</>;
}
