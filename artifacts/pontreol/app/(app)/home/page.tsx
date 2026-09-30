"use client";

import { useHomeSummary } from "@/lib/api/listings";
import { fetchApi } from "@/lib/api/client";
import { useUserLocation } from "@/lib/geolocation";
import { HomeBanner } from "@/components/home-banner";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Navigation, Search, Siren, Zap } from "lucide-react";
import Link from "next/link";

const loadMapView = () => import("@/components/map-view");
const MapView = dynamic(loadMapView, { ssr: false, loading: () => <MapPlaceholder /> });

const RADIUS_KM = 10;
// Neutral overview used only for display when no location is known. It is
// never sent to the API as the user's position.
const OVERVIEW_CENTER: [number, number] = [22.35, 78.67];
const OVERVIEW_ZOOM = 5;

function MapPlaceholder() {
  return <div className="w-full h-full flex items-center justify-center bg-card"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
}

export default function HomePage() {
  const { state: location, locate, setSearched } = useUserLocation();
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const coords = location.status === "ready" ? location.coords : null;
  const { data: summary, error } = useHomeSummary(coords, RADIUS_KM);

  // Download the Leaflet chunk while the location permission is pending.
  useEffect(() => { void loadMapView(); }, []);

  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const availableCount = useMemo(
    () => (summary?.nearbyListings || []).filter((listing) => listing.availableNow).length, [summary]);
  const pins = useMemo(
    () => (summary?.nearbyListings || []).filter((listing) => !onlyAvailable || listing.availableNow),
    [summary, onlyAvailable]);


  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError("");
    if (!address.trim() || address.length < 3) return;
    setSearching(true);
    try {
      const data = await fetchApi<{ results: { label: string; latitude: number; longitude: number }[] }>(`/geocode?q=${encodeURIComponent(address)}`);
      if (data && data.results && data.results.length > 0) {
        setSearched({ lat: data.results[0].latitude, lng: data.results[0].longitude });
      } else {
        setSearchError("Location not found. Try a nearby city or landmark.");
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Could not search that location. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const locationMessage =
    location.status === "locating" ? "Finding your location…" :
    location.status === "denied" ? "Location access is off. Search an address or city to see nearby listings, or allow location in your browser settings and tap the GPS button." :
    location.status === "unavailable" ? (location.reason === "timeout"
      ? "Couldn't get your location in time. Tap the GPS button to retry, or search an address or city."
      : "Your location isn't available on this device. Search an address or city to see nearby listings.") :
    null;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden relative">
      {/* Keep controls outside Leaflet's layers and below the mobile navigation. */}
      <div className="shrink-0 w-full px-4 pt-4 pb-3 border-b border-border bg-background space-y-3">
        <HomeBanner />
        <h1 className="text-xl font-semibold">What do you need?</h1>

        <div className="grid grid-cols-4 gap-2" aria-label="Popular needs">
          {[
            ["🔧", "Plumber", "q=plumber"], ["⚡", "Electrician", "q=electrician"], ["🚚", "Tempo", "q=tempo"],
            ["🍳", "Cook", "q=cook"], ["🧹", "Cleaning", "q=clean"], ["🚗", "Driver", "q=driver"],
            ["🏛️", "Hall", "category=spaces"], ["🔍", "Other", ""],
          ].map(([emoji, label, query]) => (
            <Link key={label} href={query ? `/discover?${query}` : "/discover"}
              className="flex flex-col items-center gap-1 rounded-xl bg-card border border-border py-2.5 text-xs font-medium active:scale-95 transition-transform">
              <span className="text-2xl leading-none" aria-hidden="true">{emoji}</span>{label}
            </Link>
          ))}
        </div>

        <div className="flex gap-2">
          <Link href="/discover?now=1" className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground" data-testid="button-need-today">
            <Zap className="h-4 w-4" /> Need it today
          </Link>
          <Link href="/emergency" className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/50 px-4 py-3 text-sm font-semibold text-red-500" data-testid="button-emergency">
            <Siren className="h-4 w-4" /> Urgent
          </Link>
        </div>

        {availableCount > 0 && (
          <button type="button" onClick={() => setOnlyAvailable(!onlyAvailable)} aria-pressed={onlyAvailable} data-testid="filter-available-now"
            className="flex w-full items-center gap-2 text-left text-sm text-emerald-600 dark:text-emerald-400">
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
            <span className="font-medium">{availableCount} {availableCount === 1 ? "helper is" : "helpers are"} free near you</span>
            <span className="ml-auto text-xs underline">{onlyAvailable ? "Show all" : "Show only them"}</span>
          </button>
        )}

        <form onSubmit={handleManualSearch} className="flex items-center gap-2 text-sm">
          <button type="button" onClick={() => { setSearchError(""); locate(); }} className="p-2 -ml-2 text-primary" title="Use my location" aria-label="Use my current location">
            <Navigation className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={coords ? "Near you · type another area to change" : "Type your area or city"}
            aria-label="Search address or city"
            className="flex-1 min-w-0 bg-transparent border-b border-border py-1.5 focus:outline-none focus:border-primary"
          />
          <button type="submit" aria-label="Search location" disabled={searching} className="p-2 text-primary">
            {searching ? <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </form>

        {(searchError || locationMessage || error) && (
          <p role="status" className="text-xs text-muted-foreground">
            {searchError || locationMessage || "Could not load helpers. Please try again."}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 relative z-0">
        {location.status === "locating" ? (
          <MapPlaceholder />
        ) : coords ? (
          <MapView listings={pins} center={[coords.lat, coords.lng]} />
        ) : (
          <MapView listings={[]} center={OVERVIEW_CENTER} zoom={OVERVIEW_ZOOM} />
        )}
      </div>
    </div>
  );
}