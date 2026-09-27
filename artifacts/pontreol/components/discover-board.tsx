"use client";

import { useListings } from "@/lib/api/listings";
import { fetchApi } from "@/lib/api/client";
import { Search, MapPin } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import React from "react";

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
  const [travelDest, setTravelDest] = useState("");
  const [departureFrom, setDepartureFrom] = useState("");
  const [departureTo, setDepartureTo] = useState("");
  const [travelSeats, setTravelSeats] = useState("");
  
  const [filters, setFilters] = useState<Record<string, string>>(fixedCategory ? { category: fixedCategory } : {});
  
  const { data: listingsData, isLoading, isError, error } = useListings(filters);
  const [geocodeError, setGeocodeError] = useState("");

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
    if (priceMin) newFilters.priceMin = priceMin;
    if (priceMax) newFilters.priceMax = priceMax;
    
    if (activeCategory !== "travel") {
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
      // Travel specific geocoding
      if (travelOrigin.length >= 3) {
        try {
          const data = await fetchApi<{ results: { latitude: number; longitude: number }[] }>(`/geocode?q=${encodeURIComponent(travelOrigin)}`);
          if (!data.results?.length) throw new Error(`Could not find the travel origin "${travelOrigin}".`);
          newFilters.originLat = data.results[0].latitude.toString();
          newFilters.originLng = data.results[0].longitude.toString();
        } catch (err) {
          setGeocodeError(err instanceof Error ? err.message : "Could not find the travel origin.");
          return;
        }
      }
      if (travelDest.length >= 3) {
        try {
          const data = await fetchApi<{ results: { latitude: number; longitude: number }[] }>(`/geocode?q=${encodeURIComponent(travelDest)}`);
          if (!data.results?.length) throw new Error(`Could not find the travel destination "${travelDest}".`);
          newFilters.destinationLat = data.results[0].latitude.toString();
          newFilters.destinationLng = data.results[0].longitude.toString();
        } catch (err) {
          setGeocodeError(err instanceof Error ? err.message : "Could not find the travel destination.");
          return;
        }
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
                  <option value="equipment">Equipment</option>
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
            <button type="submit" className="flex items-center justify-center px-6 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Search
            </button>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 p-3 bg-background/50 rounded-lg border border-border">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium uppercase">Price:</span>
              <input type="number" placeholder="Min ₹" value={priceMin} onChange={e=>setPriceMin(e.target.value)} className="w-20 h-8 bg-input border border-border rounded px-2 text-xs" />
              <input type="number" placeholder="Max ₹" value={priceMax} onChange={e=>setPriceMax(e.target.value)} className="w-20 h-8 bg-input border border-border rounded px-2 text-xs" />
            </div>
            
            <div className="w-px h-6 bg-border mx-1"></div>
            
            {activeCategory !== "travel" ? (
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
                      <img src={listing.photos[0].objectPath} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">No Image</div>
                    )}
                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur text-white text-[10px] uppercase font-bold px-2 py-1 rounded">
                      {listing.category}
                    </div>
                  </div>
                  <div className="p-4 flex flex-col flex-1">
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
                        <span className="font-bold text-lg leading-tight">₹{listing.price}</span>
                        <span className="text-[10px] text-muted-foreground uppercase">{listing.pricingMode}</span>
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
