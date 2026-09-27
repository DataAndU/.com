import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, Page, User, Listing } from "./client";

export type VerificationAdmin = {
  id: string;
  userId: string;
  legalName: string;
  idType: string;
  idMediaId: string;
  status: "pending" | "verified" | "rejected";
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

export type AuditRecord = {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, any>;
  createdAt: string;
};

export function useAdminVerifications(status?: string, cursor?: string, limit?: number) {
  return useQuery<Page<VerificationAdmin>>({
    queryKey: ["admin", "verifications", status, cursor, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      if (limit) params.set("limit", limit.toString());
      return fetchApi(`/admin/verifications?${params.toString()}`);
    }
  });
}

export function useAdminVerificationDecision() {
  const queryClient = useQueryClient();
  return useMutation<{ verification: VerificationAdmin }, Error, { id: string; decision: "verified" | "rejected"; reason?: string }>({
    mutationFn: ({ id, ...data }) => fetchApi(`/admin/verifications/${id}/decision`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "verifications"] }),
  });
}

export function useAdminUsers(search?: string, role?: string, cursor?: string, limit?: number) {
  return useQuery<Page<User>>({
    queryKey: ["admin", "users", search, role, cursor, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (role) params.set("role", role);
      if (cursor) params.set("cursor", cursor);
      if (limit) params.set("limit", limit.toString());
      return fetchApi(`/admin/users?${params.toString()}`);
    }
  });
}

export function useAdminSuspendUser() {
  const queryClient = useQueryClient();
  return useMutation<{ user: User }, Error, { id: string; suspended: boolean; reason: string }>({
    mutationFn: ({ id, ...data }) => fetchApi(`/admin/users/${id}/suspend`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useAdminListings(status?: string, cursor?: string, limit?: number) {
  return useQuery<Page<Listing>>({
    queryKey: ["admin", "listings", status, cursor, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      if (limit) params.set("limit", limit.toString());
      return fetchApi(`/admin/listings?${params.toString()}`);
    }
  });
}

export function useAdminModerateListing() {
  const queryClient = useQueryClient();
  return useMutation<{ listing: Listing | null }, Error, { id: string; action: "pause" | "restore" | "delete"; reason: string }>({
    mutationFn: ({ id, ...data }) => fetchApi(`/admin/listings/${id}/moderate`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "listings"] }),
  });
}

export function useAdminAudit(cursor?: string, limit?: number) {
  return useQuery<Page<AuditRecord>>({
    queryKey: ["admin", "audit", cursor, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (limit) params.set("limit", limit.toString());
      return fetchApi(`/admin/audit?${params.toString()}`);
    }
  });
}