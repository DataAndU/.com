"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { isClientError } from "@/lib/api/client";

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 min
        refetchOnWindowFocus: false,
        // 401/403/404/422 are deterministic; retrying them only delays the
        // error state (previously ~7s of backoff on slow mobile networks).
        retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  }));
  return (
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
      {children}
    </QueryClientProvider>
  );
}