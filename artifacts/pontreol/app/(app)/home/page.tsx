"use client";

import { useHomeSummary } from "@/lib/api/listings";
import { fetchApi } from "@/lib/api/client";
import { useUserLocation } from "@/lib/geolocation";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Navigation, Search } from "lucide-react";

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
  const { data: summary, isLoading, error } = useHomeSummary(coords, RADIUS_KM);

  // Download the Leaflet chunk while the location permission is pending.
  useEffect(() => { void loadMapView(); }, []);

  const nearbyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const listing of summary?.nearbyListings || []) counts[listing.category] = (counts[listing.category] || 0) + 1;
    return counts;
  }, [summary]);

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
      <div className="shrink-0 w-full p-3 border-b border-border bg-background">
        <form onSubmit={handleManualSearch} className="bg-card border border-border shadow-xl rounded-xl flex items-center p-2 gap-2">
          <button type="button" onClick={() => { setSearchError(""); locate(); }} className="p-2 text-primary hover:bg-white/5 rounded-lg" title="Use GPS" aria-label="Use my current location">
            <Navigation className="w-5 h-5" />
          </button>
          <input 
            type="text" 
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Search address or city..."
            aria-label="Search address or city"
            className="flex-1 min-w-0 bg-transparent border-none focus:outline-none text-sm px-2"
          />
          <button type="submit" aria-label="Search location" disabled={searching} className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            {searching ? <div className="w-5 h-5 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" /> : <Search className="w-5 h-5" />}
          </button>
        </form>

        {summary && (
          <div className="mt-2 text-xs space-y-2">
            <div>
              {summary.nearbyListings.length > 0
                ? <><span className="font-bold">{summary.nearbyListings.length}</span> {summary.nearbyListings.length === 1 ? "listing" : "listings"} within {RADIUS_KM} km of you · Tap a pin to preview</>
                : <>What do you need nearby today?</>}
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.categories.map(c => (
                <span key={c.category} className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded uppercase font-semibold">
                  {c.category} {nearbyCounts[c.category] || 0}
                </span>
              ))}
            </div>
          </div>
        )}
        <div role="status" className="text-xs text-muted-foreground mt-2">
          {searchError || locationMessage || (isLoading ? "Loading nearby listings…" : error ? "Could not load listings. Please try again." : summary?.nearbyListings.length === 0 ? `No active listings within ${RADIUS_KM} km. Search another location or add a listing from My Listings.` : null)}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative z-0">
        {location.status === "locating" ? (
          <MapPlaceholder />
        ) : coords ? (
          <MapView listings={summary?.nearbyListings || []} center={[coords.lat, coords.lng]} />
        ) : (
          <MapView listings={[]} center={OVERVIEW_CENTER} zoom={OVERVIEW_ZOOM} />
        )}
      </div>
    </div>
  );
}