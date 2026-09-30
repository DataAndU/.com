"use client";

import { fetchApi } from "@/lib/api/client";
import { LocateFixed, Search } from "lucide-react";
import { useState } from "react";

export type GeocodedLocation = {
  label: string;
  latitude: number;
  longitude: number;
};

type Props = {
  label: string;
  value: GeocodedLocation | null;
  onChange: (location: GeocodedLocation | null) => void;
  allowGps?: boolean;
};

export function AddressSearch({ label, value, onChange, allowGps = true }: Props) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [results, setResults] = useState<GeocodedLocation[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setError("Enter at least 3 characters, then search.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const data = await fetchApi<{ results: GeocodedLocation[] }>(
        `/geocode?q=${encodeURIComponent(trimmed)}`,
      );
      setResults(data.results);
      if (!data.results.length) setError("No matching address was found.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Address search failed.");
    } finally {
      setPending(false);
    }
  };

  const useGps = () => {
    if (!navigator.geolocation) {
      setError("This browser does not support GPS location.");
      return;
    }
    setPending(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = {
          label: `Current GPS location (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)})`,
          latitude: coords.latitude,
          longitude: coords.longitude,
        };
        setQuery(location.label);
        setResults([]);
        onChange(location);
        setPending(false);
      },
      (positionError) => {
        setError(positionError.message || "Unable to read your GPS location.");
        setPending(false);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  return (
    <fieldset className="space-y-2">
      <legend className="block text-sm font-medium mb-1">{label}</legend>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          required
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setResults([]);
            setError("");
            onChange(null);
          }}
          placeholder="Enter a complete address"
          className="min-w-0 flex-1 bg-input border border-border rounded-lg px-3 py-2"
        />
        <button
          type="button"
          onClick={search}
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          {pending ? "Searching…" : "Search"}
        </button>
        {allowGps && (
          <button
            type="button"
            onClick={useGps}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-border rounded-lg disabled:opacity-50"
          >
            <LocateFixed className="w-4 h-4" />
            Use GPS
          </button>
        )}
      </div>
      {results.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          {results.map((result) => (
            <button
              key={`${result.latitude}:${result.longitude}:${result.label}`}
              type="button"
              onClick={() => {
                setQuery(result.label);
                setResults([]);
                setError("");
                onChange(result);
              }}
              className="block w-full text-left px-3 py-2 text-sm bg-card hover:bg-foreground/5 border-b border-border last:border-0"
            >
              {result.label}
            </button>
          ))}
        </div>
      )}
      {value && (
        <p className="text-xs text-emerald-400">
          Location confirmed: {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </fieldset>
  );
}