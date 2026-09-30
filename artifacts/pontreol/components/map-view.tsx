"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import type { MapPin } from "@/lib/api/listings";
import { useRouter } from "next/navigation";

// Self-contained icon: pins do not depend on an external image CDN.
const listingPin = L.divIcon({
  className: "",
  html: '<svg width="44" height="48" viewBox="0 0 44 48" aria-hidden="true"><path d="M22 45C18 39 6 27 6 18a16 16 0 1 1 32 0c0 9-12 21-16 27Z" fill="#269d91" stroke="white" stroke-width="3"/><circle cx="22" cy="18" r="6" fill="white"/></svg>',
  iconSize: [44, 48],
  iconAnchor: [22, 46],
  popupAnchor: [0, -42],
});

// Bright green pin with a soft halo for providers who are "Available now".
const availablePin = L.divIcon({
  className: "",
  html: '<svg width="44" height="48" viewBox="0 0 44 48" aria-hidden="true"><circle class="pontreol-pulse" cx="22" cy="18" r="17" fill="#22c55e" opacity="0.35"/><path d="M22 45C18 39 6 27 6 18a16 16 0 1 1 32 0c0 9-12 21-16 27Z" fill="#22c55e" stroke="white" stroke-width="3"/><circle cx="22" cy="18" r="6" fill="white"/></svg>',
  iconSize: [44, 48],
  iconAnchor: [22, 46],
  popupAnchor: [0, -42],
});

function MapUpdater({ center, zoom, listings }: { center: [number, number]; zoom: number; listings: MapPin[] }) {
  const map = useMap();
  const [lat, lng] = center;
  const positionsKey = JSON.stringify(listings.map(listing => [listing.latitude, listing.longitude]));
  useEffect(() => {
    const positions: [number, number][] = JSON.parse(positionsKey);
    if (positions.length) {
      map.fitBounds(L.latLngBounds([[lat, lng], ...positions]), { padding: [40, 40], maxZoom: 15 });
    } else {
      map.setView([lat, lng], zoom);
    }
  }, [lat, lng, zoom, positionsKey, map]);
  return null;
}

export default function MapView({ listings, center, zoom = 13 }: { listings: MapPin[]; center: [number, number]; zoom?: number }) {
  const router = useRouter();
  const locatedListings = listings.filter(listing =>
    Number.isFinite(listing.latitude) && Number.isFinite(listing.longitude) &&
    Math.abs(listing.latitude) <= 90 && Math.abs(listing.longitude) <= 180);

  return (
    <MapContainer 
      center={center}
      zoom={zoom}
      className="w-full h-full"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapUpdater center={center} zoom={zoom} listings={locatedListings} />
      
      <MarkerClusterGroup showCoverageOnHover={false} spiderfyOnMaxZoom zoomToBoundsOnClick>
        {locatedListings.map(listing => (
          <Marker 
            key={listing.id} 
            position={[listing.latitude, listing.longitude]}
            icon={listing.availableNow ? availablePin : listingPin}
            title={listing.title}
            alt={`Listing: ${listing.title}`}
          >
            <Popup>
              <div className="min-w-44 text-slate-900">
                {listing.availableNow && <span className="mb-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">● Available now</span>}
                <strong className="block mb-1">{listing.title}</strong>
                <div className="text-sm">₹{listing.price} {listing.pricingMode === "negotiable" && "(Negotiable)"}</div>
                <div className="text-xs text-slate-600 mt-1 capitalize">{listing.category}</div>
                <button 
                  onClick={() => router.push(`/discover/${listing.id}`)}
                  className="mt-2 w-full min-h-11 text-center bg-primary text-primary-foreground text-sm px-3 py-2 rounded"
                >
                  View Details
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}