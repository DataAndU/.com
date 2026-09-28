"use client";

import { useMe } from "@/lib/api/account";
import { ApiError } from "@/lib/api/client";
import { redirectToSignIn } from "@/lib/auth";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * UX-only onboarding/sign-in redirects. It is NOT a security boundary: the
 * middleware sends visitors without a session cookie to /sign-in, and the API
 * re-verifies the session, suspension and role on every request.
 *
 * Children render immediately so page data requests start in parallel with
 * /api/me instead of waiting behind a full-page spinner. Only an account that
 * is confirmed to have no role yet is held back while it is sent to onboarding.
 */
export function RoleGuard({ children }: { children: React.ReactNode }) {
  const { data: user, error } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const needsOnboarding = !!user && !user.role && pathname !== "/onboarding";
  // Cookie present but the session expired or was revoked.
  const signedOut = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (signedOut) redirectToSignIn();
    else if (needsOnboarding) router.replace("/onboarding");
  }, [signedOut, needsOnboarding, router]);

  if (needsOnboarding || signedOut) {
    return <div className="flex-1 flex items-center justify-center bg-background"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  }

  return <>{children}</>;
}
