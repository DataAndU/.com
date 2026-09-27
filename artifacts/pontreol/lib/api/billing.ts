import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, Plan, Subscription, Payment, Discount } from "./client";

export function usePlans() {
  return useQuery<{ plans: Plan[]; testMode: boolean; checkoutAvailable: boolean }>({
    queryKey: ["billing", "plans"],
    queryFn: () => fetchApi("/billing/plans"),
  });
}

export function useBillingStatus() {
  return useQuery<{ paid: boolean; freeContactLimit: number; subscription: Subscription | null; testMode: boolean }>({
    queryKey: ["billing", "status"],
    queryFn: () => fetchApi("/billing/status"),
  });
}

export function usePayments() {
  return useQuery<{ payments: Payment[] }>({
    queryKey: ["billing", "payments"],
    queryFn: () => fetchApi("/billing/payments"),
  });
}

type CheckoutData = { keyId: string; subscriptionId: string; name: string; description: string };

export function useSubscribe() {
  return useMutation<{ subscription: Subscription; checkout: CheckoutData; testMode: boolean }, Error, { planId: string; discountCode?: string }>({
    mutationFn: (data) => fetchApi("/billing/subscribe", { method: "POST", body: JSON.stringify(data) }),
  });
}

export function useVerifySubscription() {
  const queryClient = useQueryClient();
  return useMutation<{ subscription: Subscription }, Error, { subscriptionId: string; razorpayPaymentId: string; razorpaySignature: string }>({
    mutationFn: (data) => fetchApi("/billing/verify", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing", "status"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "payments"] });
    }
  });
}

export function useChangePlan() {
  const queryClient = useQueryClient();
  return useMutation<{ subscription: Subscription }, Error, { subscriptionId: string; planId: string }>({
    mutationFn: (data) => fetchApi("/billing/change-plan", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing", "status"] });
    }
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation<{ subscription: Subscription }, Error, { subscriptionId: string }>({
    mutationFn: (data) => fetchApi("/billing/cancel", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing", "status"] });
    }
  });
}

// Admin
export function useAdminPlans() {
  return useQuery<{ plans: Plan[] }>({
    queryKey: ["admin", "billing", "plans"],
    queryFn: () => fetchApi("/admin/billing/plans"),
  });
}

export function useAdminCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation<Plan, Error, Omit<Plan, "id">>({
    mutationFn: (data) => fetchApi("/admin/billing/plans", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "billing", "plans"] }),
  });
}

export function useAdminUpdatePlan() {
  const queryClient = useQueryClient();
  return useMutation<Plan, Error, { id: string; data: Omit<Plan, "id"> }>({
    mutationFn: ({ id, data }) => fetchApi(`/admin/billing/plans/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "billing", "plans"] }),
  });
}

export function useAdminDiscounts() {
  return useQuery<{ discounts: Discount[] }>({
    queryKey: ["admin", "billing", "discounts"],
    queryFn: () => fetchApi("/admin/billing/discounts"),
  });
}

export function useAdminCreateDiscount() {
  const queryClient = useQueryClient();
  return useMutation<Discount, Error, Omit<Discount, "id" | "uses">>({
    mutationFn: (data) => fetchApi("/admin/billing/discounts", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "billing", "discounts"] }),
  });
}

export function useAdminUpdateDiscount() {
  const queryClient = useQueryClient();
  return useMutation<Discount, Error, { id: string; data: Omit<Discount, "id" | "uses"> }>({
    mutationFn: ({ id, data }) => fetchApi(`/admin/billing/discounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "billing", "discounts"] }),
  });
}

export function useAdminSettings() {
  return useQuery<{ freeContactLimit: number }>({
    queryKey: ["admin", "billing", "settings"],
    queryFn: () => fetchApi("/admin/billing/settings"),
  });
}

export function useAdminUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation<{ freeContactLimit: number }, Error, { freeContactLimit: number }>({
    mutationFn: (data) => fetchApi("/admin/billing/settings", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "billing", "settings"] }),
  });
}

export function useAdminRevenue() {
  return useQuery<{ currency: string; testMode: boolean; totalCapturedPaise: number; payments: Payment[]; subscriptions: Subscription[] }>({
    queryKey: ["admin", "billing", "revenue"],
    queryFn: () => fetchApi("/admin/billing/revenue"),
  });
}