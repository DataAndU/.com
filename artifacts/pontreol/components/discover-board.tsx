"use client";

import { ListingPhoto } from "@/components/listing-photo";
import { useListings } from "@/lib/api/listings";
import { fetchApi } from "@/lib/api/client";
import { Search, MapPin } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import React from "react";
import { VoiceSearchButton } from "@/components/voice-search-button";

type DiscoverBoardProps = {
  fixedCategory?: string;
  headerContent?: React.ReactNode;
};

export function DiscoverBoard({ fixedCategory, headerContent }: DiscoverBoardProps) {
  const router = useRouter();
  
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(fixedCategory || "");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  
  // Geolocation / Distance
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [distanceKm, setDistanceKm] = useState("50");
  
  const [travelOrigin, setTravelOrigin] = useState("");
  const [nowOnly, setNowOnly] = useState(false);
  const [dealsOnly, setDealsOnly] = useState(false);
  const [deliveryFrom, setDeliveryFrom] = useState("");
  const [deliveryTo, setDeliveryTo] = useState("");
  const [travelDest, setTravelDest] = useState("");
  const [departureFrom, setDepartureFrom] = useState("");
  const [departureTo, setDepartureTo] = useState("");
  const [travelSeats, setTravelSeats] = useState("");
  
  const [filters, setFilters] = useState<Record<string, string>>(fixedCategory ? { category: fixedCategory } : {});
  
  const { data: listingsData, isLoading, isError, error } = useListings(filters);
  const [geocodeError, setGeocodeError] = useState("");

  // Links such as /discover?now=1 open with "Available now" switched on.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const cat = params.get("category");
    if (cat && !fixedCategory && ["services", "spaces", "delivery", "travel"].includes(cat)) {
      setCategory(cat);
      setFilters((prev) => ({ ...prev, category: cat }));
    }
    if (params.get("now") === "1" || q) {
      if (params.get("now") === "1") setNowOnly(true);
      if (q) setSearch(q);
      setFilters((prev) => ({ ...prev, ...(params.get("now") === "1" ? { availableNow: "true" } : {}), ...(q ? { search: q } : {}) }));
    }
  }, []);

  // Sync category if fixedCategory changes (e.g. navigation)
  useEffect(() => {
    if (fixedCategory) {
      setCategory(fixedCategory);
      setFilters(prev => ({ ...prev, category: fixedCategory }));
    }
  }, [fixedCategory]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeocodeError("");
    const newFilters: Record<string, string> = {};
    if (search) newFilters.search = search;
    const activeCategory = fixedCategory || category;
    if (activeCategory) newFilters.category = activeCategory;
    if (nowOnly) newFilters.availableNow = "true";
    if (dealsOnly) newFilters.deals = "true";
    if (priceMin) newFilters.priceMin = priceMin;
    if (priceMax) newFilters.priceMax = priceMax;
    
    if (activeCategory === "delivery" && (deliveryFrom.trim().length >= 3 || deliveryTo.trim().length >= 3)) {
      // Delivery: both ends must be inside the provider's service area.
      const lookup = (query: string) =>
        query.trim().length >= 3
          ? fetchApi<{ results: { latitude: number; longitude: number }[] }>(`/geocode?q=${encodeURIComponent(query.trim())}`)
          : Promise.resolve(null);
      const ends = await Promise.allSettled([lookup(deliveryFrom), lookup(deliveryTo)]);
      const names = ["From", "To"] as const;
      const keys = [["pickupLat", "pickupLng"], ["dropoffLat", "dropoffLng"]] as const;
      for (let i = 0; i < 2; i++) {
        const text = i === 0 ? deliveryFrom : deliveryTo;
        if (text.trim().length < 3) continue;
        const r = ends[i];
        if (r.status === "rejected" || !r.value?.results?.length) {
          setGeocodeError(`Could not find the ${names[i]} address "${text}".`);
          return;
        }
        newFilters[keys[i][0]] = r.value.results[0].latitude.toString();
        newFilters[keys[i][1]] = r.value.results[0].longitude.toString();
      }
    } else if (activeCategory !== "travel") {
      if (address && address.length >= 3) {
        try {
          const data = await fetchApi<{ results: { latitude: number; longitude: number }[] }>(`/geocode?q=${encodeURIComponent(address)}`);
          if (!data.results?.length) throw new Error("No matching location was found. Check the address and try again.");
          newFilters.lat = data.results[0].latitude.toString();
          newFilters.lng = data.results[0].longitude.toString();
          if (distanceKm) newFilters.distanceKm = distanceKm;

          setLat(newFilters.lat);
          setLng(newFilters.lng);
        } catch (err) {
          setGeocodeError(err instanceof Error ? err.message : "Could not find that location. Please try again.");
          return;
        }
      } else {
        if (lat) newFilters.lat = lat;
        if (lng) newFilters.lng = lng;
        if (distanceKm && (lat || newFilters.lat)) newFilters.distanceKm = distanceKm;
      }
    } else {
      // Travel specific geocoding: origin and destination resolve in parallel.
      const lookup = (query: string) =>
        query.length >= 3
          ? fetchApi<{ results: { latitude: number; longitude: number }[] }>(`/geocode?q=${encodeURIComponent(query)}`)
          : Promise.resolve(null);
      const [origin, destination] = await Promise.allSettled([lookup(travelOrigin), lookup(travelDest)]);
      if (travelOrigin.length >= 3) {
        if (origin.status === "rejected") {
          setGeocodeError(origin.reason instanceof Error ? origin.reason.message : "Could not find the travel origin.");
          return;
        }
        if (!origin.value?.results?.length) {
          setGeocodeError(`Could not find the travel origin "${travelOrigin}".`);
          return;
        }
        newFilters.originLat = origin.value.results[0].latitude.toString();
        newFilters.originLng = origin.value.results[0].longitude.toString();
      }
      if (travelDest.length >= 3) {
        if (destination.status === "rejected") {
          setGeocodeError(destination.reason instanceof Error ? destination.reason.message : "Could not find the travel destination.");
          return;
        }
        if (!destination.value?.results?.length) {
          setGeocodeError(`Could not find the travel destination "${travelDest}".`);
          return;
        }
        newFilters.destinationLat = destination.value.results[0].latitude.toString();
        newFilters.destinationLng = destination.value.results[0].longitude.toString();
      }
      if (departureFrom) newFilters.departureFrom = new Date(departureFrom).toISOString();
      if (departureTo) newFilters.departureTo = new Date(departureTo).toISOString();
      if (travelSeats) newFilters.seats = travelSeats;
    }
    
    setFilters(newFilters);
  };

  const activeCategory = fixedCategory || category;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 border-b border-border bg-card px-6 py-4">
        {headerContent}
        <form onSubmit={handleSearch} className="flex flex-col gap-3">
          <div className="flex gap-3">
            {!fixedCategory && (
              <div className="w-40 shrink-0">
                <select 
                  value={category} 
                  onChange={e => setCategory(e.target.value)}
                  className="w-full h-10 bg-input border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">All Categories</option>
                  <option value="services">Services</option>
                  <option value="spaces">Spaces</option>
                  <option value="delivery">Delivery</option>
                  <option value="travel">Travel</option>
                </select>
              </div>
            )}
            <div className="flex-1 relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input 
                type="text" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search listings..." 
                className="w-full h-10 pl-10 pr-4 bg-input border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <VoiceSearchButton onText={(text) => { setSearch(text); setFilters((prev) => ({ ...prev, search: text })); }} />
            <button type="submit" className="flex items-center justify-center px-6 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Search
            </button>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 p-3 bg-background/50 rounded-lg border border-border">
            <button type="button" aria-pressed={nowOnly}
              onClick={() => { const next = !nowOnly; setNowOnly(next); setFilters((prev) => { const f = { ...prev }; if (next) f.availableNow = "true"; else delete f.availableNow; return f; }); }}
              className={`h-8 rounded-full px-3 text-xs font-semibold border ${nowOnly ? "bg-emerald-500 text-white border-emerald-500" : "border-border text-muted-foreground"}`}>
              ● Available now
            </button>
            <button type="button" aria-pressed={dealsOnly}
              onClick={() => { const next = !dealsOnly; setDealsOnly(next); setFilters((prev) => { const f = { ...prev }; if (next) f.deals = "true"; else delete f.deals; return f; }); }}
              className={`h-8 rounded-full px-3 text-xs font-semibold border ${dealsOnly ? "bg-amber-500 text-black border-amber-500" : "border-border text-muted-foreground"}`}>
              ⚡ Deals
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium uppercase">Price:</span>
              <input type="number" placeholder="Min ₹" value={priceMin} onChange={e=>setPriceMin(e.target.value)} className="w-20 h-8 bg-input border border-border rounded px-2 text-xs" />
              <input type="number" placeholder="Max ₹" value={priceMax} onChange={e=>setPriceMax(e.target.value)} className="w-20 h-8 bg-input border border-border rounded px-2 text-xs" />
            </div>
            
            <div className="w-px h-6 bg-border mx-1"></div>
            
            {activeCategory === "delivery" ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium uppercase">Deliver:</span>
                <input type="text" placeholder="From..." value={deliveryFrom} onChange={e=>setDeliveryFrom(e.target.value)} className="w-28 h-8 bg-input border border-border rounded px-2 text-xs" />
                <input type="text" placeholder="To..." value={deliveryTo} onChange={e=>setDeliveryTo(e.target.value)} className="w-28 h-8 bg-input border border-border rounded px-2 text-xs" />
              </div>
            ) : activeCategory !== "travel" ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium uppercase">Location:</span>
                <input type="text" placeholder="City or area..." value={address} onChange={e=>setAddress(e.target.value)} className="w-32 h-8 bg-input border border-border rounded px-2 text-xs" />
                <select value={distanceKm} onChange={e=>setDistanceKm(e.target.value)} className="h-8 bg-input border border-border rounded px-2 text-xs">
                  <option value="10">10 km</option>
                  <option value="25">25 km</option>
                  <option value="50">50 km</option>
                  <option value="100">100 km</option>
                </select>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium uppercase">Route:</span>
                  <input type="text" placeholder="Origin..." value={travelOrigin} onChange={e=>setTravelOrigin(e.target.value)} className="w-24 h-8 bg-input border border-border rounded px-2 text-xs" />
                  <input type="text" placeholder="Destination..." value={travelDest} onChange={e=>setTravelDest(e.target.value)} className="w-24 h-8 bg-input border border-border rounded px-2 text-xs" />
                </div>
                <div className="w-px h-6 bg-border mx-1"></div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium uppercase">Dates:</span>
                  <input type="date" value={departureFrom} onChange={e=>setDepartureFrom(e.target.value)} className="w-32 h-8 bg-input border border-border rounded px-2 text-xs" />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input type="date" value={departureTo} onChange={e=>setDepartureTo(e.target.value)} className="w-32 h-8 bg-input border border-border rounded px-2 text-xs" />
                </div>
                <div className="w-px h-6 bg-border mx-1"></div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium uppercase">Seats:</span>
                  <input type="number" placeholder="Seats" value={travelSeats} onChange={e=>setTravelSeats(e.target.value)} className="w-20 h-8 bg-input border border-border rounded px-2 text-xs" />
                </div>
              </>
            )}
          </div>
        </form>
        {geocodeError && (
          <div role="alert" className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Location search failed: {geocodeError}
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto">
          {isLoading ? (
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mt-10" />
          ) : isError ? (
            <div role="alert" className="py-20 text-center border border-destructive/20 rounded-xl bg-destructive/5">
              <p className="font-medium text-destructive">We couldn’t load listings.</p>
              <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Please try again."}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {listingsData?.items.map(listing => (
                <div key={listing.id} onClick={() => router.push(`/discover/${listing.id}`)} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col group cursor-pointer hover:border-primary/50 transition-colors">
                  <div className="aspect-video bg-input relative overflow-hidden">
                    {listing.photos && listing.photos.length > 0 ? (
                      <ListingPhoto photo={listing.photos[0]} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">No Image</div>
                    )}
                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur text-white text-[10px] uppercase font-bold px-2 py-1 rounded">
                      {listing.category}
                    </div>
                    {listing.dealPercent ? (
                      <div className="absolute bottom-2 left-2 bg-amber-500 text-black text-[10px] font-bold px-2 py-1 rounded">⚡ {listing.dealPercent}% off today</div>
                    ) : null}
                    {listing.provider?.availableNow && (
                      <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded">● Free now</div>
                    )}
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    {listing.provider && (
                      <div className="flex items-center gap-2 mb-2 min-w-0">
                        <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden bg-secondary flex items-center justify-center text-xs font-bold">
                          {listing.provider.avatarUrl
                            ? <img src={listing.provider.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                            : (listing.provider.displayName || "?").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 text-xs">
                          <p className="font-semibold truncate">
                            {listing.provider.displayName}
                            {listing.provider.verificationStatus === "verified" && <span className="ml-1 text-sky-400" title="ID verified">✓</span>}
                          </p>
                          <p className="text-muted-foreground">
                            {listing.provider.reviewCount > 0
                              ? <>⭐ {listing.provider.rating.toFixed(1)} · {listing.provider.reviewCount} {listing.provider.reviewCount === 1 ? "review" : "reviews"}</>
                              : "New on Pontreol"}
                          </p>
                        </div>
                      </div>
                    )}
                    <h3 className="font-semibold text-lg line-clamp-1 mb-1">{listing.title}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate">{listing.locationLabel}</span>
                      {listing.distanceKm !== undefined && (
                        <span className="ml-1 text-primary">({listing.distanceKm.toFixed(1)} km)</span>
                      )}
                    </div>
                    <div className="text-muted-foreground text-sm mb-4 line-clamp-2">{listing.description}</div>
                    
                    <div className="mt-auto flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground">Starts from</span>
                        {listing.dealPrice ? (
                          <span className="font-bold text-lg leading-tight">₹{listing.dealPrice.toLocaleString("en-IN")} <span className="text-xs font-normal text-muted-foreground line-through">₹{listing.price.toLocaleString("en-IN")}</span></span>
                        ) : (
                          <span className="font-bold text-lg leading-tight">₹{listing.price.toLocaleString("en-IN")}</span>
                        )}
                        {listing.pricingMode === "negotiable" && <span className="text-[10px] text-muted-foreground">Price can be discussed</span>}
                      </div>
                      <button className="px-4 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-xs font-medium hover:bg-secondary/90 transition-colors">
                        View
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              
              {(!listingsData?.items || listingsData.items.length === 0) && (
                <div className="col-span-full py-20 text-center border border-dashed border-border rounded-xl bg-card/50">
                  <Search className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-muted-foreground">No listings found matching your search.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
