"use client";

import { useMe } from "@/lib/api/account";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

export function RoleGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading) {
      if (isError) {
        // Either not logged in properly or backend is unreachable, maybe redirect to sign in
        // In this case, Clerk should protect but the backend might not have the user yet.
      } else if (user && !user.role && pathname !== "/onboarding") {
        router.replace("/onboarding");
      }
    }
  }, [user, isLoading, isError, router, pathname]);

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center bg-background"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  }

  return <>{children}</>;
}