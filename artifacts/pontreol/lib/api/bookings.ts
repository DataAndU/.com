import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, Booking, Page } from "./client";

export function useBookings(filters: Record<string, string>) {
  return useQuery<Page<Booking>>({
    queryKey: ["bookings", filters],
    queryFn: () => {
      const params = new URLSearchParams(filters);
      return fetchApi(`/bookings?${params.toString()}`);
    }
  });
}

export function useBooking(id: string) {
  return useQuery<{ booking: Booking; route: any | null }>({
    queryKey: ["booking", id],
    queryFn: () => fetchApi(`/bookings/${id}`),
    enabled: !!id,
  });
}

export function useCreateServiceBooking() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { listingId: string; requestedAt: string; note?: string }>({
    mutationFn: (data) => fetchApi("/bookings/services", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

export function useCreateSpaceBooking() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { listingId: string; mode: "daily" | "hourly"; checkIn: string; checkOut: string; note?: string }>({
    mutationFn: (data) => fetchApi("/bookings/spaces", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

export function useCreateEquipmentBooking() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { listingId: string; startsAt: string; endsAt: string; operatorRequested: boolean; note?: string }>({
    mutationFn: (data) => fetchApi("/bookings/equipment", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

export function useCreateDeliveryBooking() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { listingId: string; pickup: any; dropoff: any; pickupAt: string; itemDescription: string; loadKg?: number; note?: string }>({
    mutationFn: (data) => fetchApi("/bookings/delivery", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

export function useCreateTravelBooking() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { listingId: string; seats: number; note?: string }>({
    mutationFn: (data) => fetchApi("/bookings/travel", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

export function useUpdateBookingStatus() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { id: string; status: string }>({
    mutationFn: ({ id, status }) => fetchApi(`/bookings/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["booking", id] });
    }
  });
}

export function useQuoteBooking() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { id: string; quotedPrice: number; message?: string }>({
    mutationFn: ({ id, ...data }) => fetchApi(`/bookings/${id}/quote`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["booking", id] });
    }
  });
}

export function useQuoteResponse() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { id: string; accept: boolean }>({
    mutationFn: ({ id, accept }) => fetchApi(`/bookings/${id}/quote-response`, { method: "POST", body: JSON.stringify({ accept }) }),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["booking", id] });
    }
  });
}

export function useCompleteBooking() {
  const queryClient = useQueryClient();
  return useMutation<Booking, Error, { id: string }>({
    mutationFn: ({ id }) => fetchApi(`/bookings/${id}/complete`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["booking", id] });
    }
  });
}

export function useCreateReview() {
  return useMutation<any, Error, { bookingId: string; rating: number; comment: string; photoIds?: string[] }>({
    mutationFn: ({ bookingId, ...data }) => fetchApi(`/bookings/${bookingId}/reviews`, { method: "POST", body: JSON.stringify(data) }),
  });
}