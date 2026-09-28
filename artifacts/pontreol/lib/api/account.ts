import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, isClientError, User, Page, ProviderSummary, Listing } from "./client";

export const getMeQueryKey = () => ["account", "me"];

/**
 * The signed-in profile is shared by the sidebar, RoleGuard and pages through
 * one React Query cache entry, so client navigation does not refetch it.
 * This cache only drives UI; every API endpoint re-authorizes from the
 * Pontreol session cookie and the database. It is invalidated by profile/role/
 * verification mutations; sign-in and sign-out are full page loads, so no
 * cached data survives an account switch (see lib/auth.ts).
 */
export const ME_STALE_TIME_MS = 5 * 60 * 1000;

export function useMe() {
  return useQuery<User>({
    queryKey: getMeQueryKey(),
    queryFn: () => fetchApi("/me"),
    staleTime: ME_STALE_TIME_MS,
    gcTime: 30 * 60 * 1000,
    // Refresh when the user returns to the tab so admin-side changes
    // (suspension, verification, admin grant) surface without a reload.
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => !isClientError(error) && failureCount < 1,
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation<User, Error, { role: "buyer" | "provider" }>({
    mutationFn: (data) => fetchApi("/me/role", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      queryClient.setQueryData(getMeQueryKey(), data);
    }
  });
}

export type ReferralStats = { code: string; path: string; invited: number; providers: number; creditMonths: number };

export function useReferral() {
  return useQuery<ReferralStats>({ queryKey: ["referral"], queryFn: () => fetchApi("/me/referral"), staleTime: 60_000 });
}

/** Provider "Available now" switch; the server turns it off after `hours`. */
export function useSetAvailability() {
  const queryClient = useQueryClient();
  return useMutation<User, Error, { available: boolean; hours?: number }>({
    mutationFn: (data) => fetchApi("/me/availability", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      queryClient.setQueryData(getMeQueryKey(), data);
      queryClient.invalidateQueries({ queryKey: ["home-summary"] });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation<User, Error, { displayName?: string; phone?: string; contactEmailVisible?: boolean; contactPhoneVisible?: boolean }>({
    mutationFn: (data) => fetchApi("/me", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      queryClient.setQueryData(getMeQueryKey(), data);
    }
  });
}

export function useProvider(providerId: string) {
  return useQuery<{ provider: ProviderSummary; listings: Listing[]; reviews: any[] }>({
    queryKey: ["provider", providerId],
    queryFn: () => fetchApi(`/providers/${providerId}`),
    enabled: !!providerId,
  });
}

export function useNotifications() {
  return useQuery<Page<any>>({
    queryKey: ["notifications"],
    queryFn: () => fetchApi("/notifications"),
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation<any, Error, { id: string }>({
    mutationFn: ({ id }) => fetchApi(`/notifications/${id}/read`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });
}

export function useNotificationPreferences() {
  return useQuery<any>({
    queryKey: ["notification-preferences"],
    queryFn: () => fetchApi("/notification-preferences"),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation<any, Error, any>({
    mutationFn: (data) => fetchApi("/notification-preferences", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["notification-preferences"], data);
    }
  });
}

export function useVerification() {
  return useQuery<any>({
    queryKey: ["verification"],
    queryFn: () => fetchApi("/verification"),
  });
}

export function useSubmitVerification() {
  const queryClient = useQueryClient();
  return useMutation<any, Error, { legalName: string; idType: string; idMediaId: string }>({
    mutationFn: (data) => fetchApi("/verification", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["verification"] });
      queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
    }
  });
}
