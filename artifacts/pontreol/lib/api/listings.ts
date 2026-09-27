import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, Listing, Page, Media } from "./client";

/** Compact listing projection returned by `/home/summary?view=map`. */
export type MapPin = Pick<Listing, "id" | "providerId" | "category" | "title" | "price" | "pricingMode" | "currency" | "latitude" | "longitude" | "status" | "distanceKm">;

export type HomeSummary = { totalListings: number; categories: { category: string; count: number }[]; nearbyListings: MapPin[] };

/**
 * Nearby listings for the map. Disabled until real coordinates exist, so no
 * request is ever made for a placeholder location.
 */
export function useHomeSummary(coords: { lat: number; lng: number } | null, distanceKm: number) {
  return useQuery<HomeSummary>({
    queryKey: ["home-summary", coords?.lat, coords?.lng, distanceKm],
    queryFn: () => {
      const params = new URLSearchParams({
        lat: String(coords!.lat),
        lng: String(coords!.lng),
        distanceKm: String(distanceKm),
        view: "map",
      });
      return fetchApi(`/home/summary?${params.toString()}`);
    },
    enabled: coords !== null,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useListings(filters: Record<string, string>) {
  return useQuery<Page<Listing>>({
    queryKey: ["listings", filters],
    queryFn: () => {
      const params = new URLSearchParams(filters);
      return fetchApi(`/listings?${params.toString()}`);
    }
  });
}

export function useListing(id: string) {
  return useQuery<Listing>({
    queryKey: ["listing", id],
    queryFn: () => fetchApi(`/listings/${id}`),
    enabled: !!id,
  });
}

export function useMyListings() {
  return useQuery<{ items: Listing[] }>({
    queryKey: ["my-listings"],
    queryFn: () => fetchApi("/my/listings"),
  });
}

export function useCreateListing() {
  const queryClient = useQueryClient();
  return useMutation<Listing, Error, any>({
    mutationFn: (data) => fetchApi("/listings", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-listings"] });
      queryClient.invalidateQueries({ queryKey: ["home-summary"] });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    }
  });
}

export function useUpdateListing() {
  const queryClient = useQueryClient();
  return useMutation<Listing, Error, { id: string; data: any }>({
    mutationFn: ({ id, data }) => fetchApi(`/listings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["my-listings"] });
      queryClient.invalidateQueries({ queryKey: ["home-summary"] });
      queryClient.invalidateQueries({ queryKey: ["listing", id] });
    }
  });
}

export function useDeleteListing() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => fetchApi(`/listings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-listings"] });
      queryClient.invalidateQueries({ queryKey: ["home-summary"] });
    }
  });
}

export function useUpdateListingStatus() {
  const queryClient = useQueryClient();
  return useMutation<Listing, Error, { id: string; status: "active" | "paused" }>({
    mutationFn: ({ id, status }) => fetchApi(`/listings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["my-listings"] });
      queryClient.invalidateQueries({ queryKey: ["home-summary"] });
      queryClient.invalidateQueries({ queryKey: ["listing", id] });
    }
  });
}

export function useListingAvailability(id: string, from: string, to: string) {
  return useQuery<{ slots: { startsAt: string; endsAt: string; available: boolean }[] }>({
    queryKey: ["availability", id, from, to],
    queryFn: () => fetchApi(`/listings/${id}/availability?from=${from}&to=${to}`),
    enabled: !!id && !!from && !!to,
  });
}

export function useUpdateAvailability() {
  const queryClient = useQueryClient();
  return useMutation<any, Error, { id: string; data: { timezone: string; slots: { startsAt: string; endsAt: string }[] } }>({
    mutationFn: ({ id, data }) => fetchApi(`/listings/${id}/availability`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["availability", id] });
    }
  });
}

export async function uploadMedia(file: File, purpose: "listingPhoto" | "verificationId") {
  // 1. Get upload URL
  const data = await fetchApi<{ mediaId: string; uploadUrl: string; objectPath: string; requiredHeaders: Record<string, string> }>("/media/uploads", {
    method: "POST",
    body: JSON.stringify({
      purpose,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })
  });

  // 2. Upload to storage
  const uploadRes = await fetch(data.uploadUrl, {
    method: "PUT",
    headers: {
      ...data.requiredHeaders,
      "Content-Type": file.type,
    },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error("Failed to upload file to storage");
  }

  // 3. Finalize
  const finalizeData = await fetchApi<{ media: Media }>(`/media/${data.mediaId}/finalize`, { method: "POST", body: JSON.stringify({}) });
  return finalizeData.media;
}
