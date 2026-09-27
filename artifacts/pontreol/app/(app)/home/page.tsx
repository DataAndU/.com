"use client";

import { useHomeSummary } from "@/lib/api/listings";
import { fetchApi } from "@/lib/api/client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Navigation, Search } from "lucide-react";

const MapView = dynamic(() => import("@/components/map-view"), { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center bg-card"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div> });

export default function HomePage() {
  const [lat, setLat] = useState<number>(28.6139); // Default to New Delhi
  const [lng, setLng] = useState<number>(77.2090);
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);

  const { data: summary, isLoading, error } = useHomeSummary(lat, lng, 10);

  useEffect(() => {
    // Try to get user location
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
      }, () => {
        // Fallback to default
      });
    }
  }, []);

  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim() || address.length < 3) return;
    setSearching(true);
    try {
      const data = await fetchApi<{ results: { label: string; latitude: number; longitude: number }[] }>(`/geocode?q=${encodeURIComponent(address)}`);
      if (data && data.results && data.results.length > 0) {
        setLat(data.results[0].latitude);
        setLng(data.results[0].longitude);
      } else {
        alert("Location not found");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden relative">
      {/* Keep controls outside Leaflet's layers and below the mobile navigation. */}
      <div className="shrink-0 w-full p-3 border-b border-border bg-background">
        <form onSubmit={handleManualSearch} className="bg-card border border-border shadow-xl rounded-xl flex items-center p-2 gap-2">
          <button type="button" onClick={() => {
            if ("geolocation" in navigator) {
              navigator.geolocation.getCurrentPosition((pos) => {
                setLat(pos.coords.latitude);
                setLng(pos.coords.longitude);
              });
            }
          }} className="p-2 text-primary hover:bg-white/5 rounded-lg" title="Use GPS">
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
              <span className="font-bold">{summary.nearbyListings.length}</span> listings within 10 km · Tap a pin to preview
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.categories.map(c => (
                <span key={c.category} className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded uppercase font-semibold">
                  {c.category} {summary.nearbyListings.filter(listing => listing.category === c.category).length}
                </span>
              ))}
            </div>
          </div>
        )}
        <div role="status" className="text-xs text-muted-foreground mt-2">
          {isLoading ? "Loading nearby listings…" : error ? "Could not load listings. Please try again." : summary?.nearbyListings.length === 0 ? "No active listings within 10 km. Search another location or add a listing from My Listings." : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative z-0">
        <MapView listings={summary?.nearbyListings || []} center={[lat, lng]} />
      </div>
    </div>
  );
}