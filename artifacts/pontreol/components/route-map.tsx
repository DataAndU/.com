"use client";

import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type Route = { geometry?: { coordinates: [number, number][] } } | null;

/** Delivery route line. Loaded only in the browser (Leaflet needs `window`). */
export default function RouteMap({ route }: { route: Route }) {
  if (!route?.geometry) return null;
  const positions = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]); // GeoJSON is [lng, lat]
  return (
    <div className="h-64 rounded-xl overflow-hidden border border-border mt-4">
      <MapContainer bounds={positions} zoomControl={false} className="w-full h-full">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Polyline positions={positions} color="hsl(173 58% 39%)" weight={4} />
      </MapContainer>
    </div>
  );
}
