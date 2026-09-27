import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "./client";

export function useGeocode(query: string) {
  return useQuery<{ results: { label: string; latitude: number; longitude: number }[] }>({
    queryKey: ["geocode", query],
    queryFn: () => fetchApi(`/geocode?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 3,
  });
}