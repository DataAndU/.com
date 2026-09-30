"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import type { MapPin } from "@/lib/api/listings";
import { availabilityText, priceText } from "@/lib/availability";

// Price "pill" markers, cached so re-renders never rebuild identical icons.
const iconCache = new Map<string, L.DivIcon>();
function pillIcon(label: string, now: boolean, selected: boolean) {
  const key = `${label}|${now}|${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const bg = selected ? "#111827" : now ? "#16a34a" : "#ffffff";
    const fg = selected || now ? "#ffffff" : "#111827";
    icon = L.divIcon({
      className: "",
      html: `<div style="transform:translate(-50%,-100%);display:inline-flex;align-items:center;gap:4px;white-space:nowrap;padding:4px 9px;border-radius:999px;font:600 13px/1.2 system-ui,sans-serif;background:${bg};color:${fg};border:1.5px solid ${selected ? "#111827" : now ? "#15803d" : "#d1d5db"};box-shadow:0 1px 4px rgba(0,0,0,.25)">${now && !selected ? "●&nbsp;" : ""}${label}</div>`,
      // null: size comes from the label itself, so the whole pill is tappable.
      iconSize: null as unknown as L.PointExpression,
    });
    iconCache.set(key, icon);
  }
  return icon;
}

export type Viewport = { lat: number; lng: number; radiusKm: number };

function MoveWatcher({ onMove }: { onMove: (v: Viewport) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useRef(false);
  const map = useMap();
  // Only follow the map after the person touches/scrolls it; programmatic
  // centering (initial view, new location) must not narrow the results.
  useEffect(() => {
    const container = map.getContainer();
    const mark = () => { touched.current = true; };
    container.addEventListener("pointerdown", mark);
    container.addEventListener("wheel", mark, { passive: true });
    return () => { container.removeEventListener("pointerdown", mark); container.removeEventListener("wheel", mark); };
  }, [map]);
  useMapEvents({
    moveend(event) {
      if (!touched.current) return;
      const map = event.target as L.Map;
      if (timer.current) clearTimeout(timer.current);
      // Debounced: one query after the user stops dragging, not while dragging.
      timer.current = setTimeout(() => {
        const center = map.getCenter();
        const radiusKm = Math.min(100, Math.max(1, center.distanceTo(map.getBounds().getNorthEast()) / 1000));
        onMove({ lat: center.lat, lng: center.lng, radiusKm });
      }, 600);
    },
  });
  return null;
}

function Recenter({ center, zoom, focus }: { center: [number, number]; zoom: number; focus: [number, number] | null }) {
  const map = useMap();
  const [lat, lng] = center;
  useEffect(() => { map.setView([lat, lng], zoom); }, [lat, lng, zoom, map]);
  useEffect(() => {
    if (focus && !map.getBounds().pad(-0.15).contains(focus)) map.panTo(focus);
  }, [focus, map]);
  return null;
}

/** Without a known location, frame the results instead of all of India (once per result set). */
function FitToPins({ pins }: { pins: MapPin[] }) {
  const map = useMap();
  const key = pins.map((p) => p.id).join(",");
  useEffect(() => {
    if (!pins.length) return;
    map.fitBounds(L.latLngBounds(pins.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [48, 48], maxZoom: 14 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ExploreMap({ pins, center, zoom, user, selectedId, onSelect, onMove, fitToPins = false }: {
  pins: MapPin[];
  center: [number, number];
  zoom: number;
  user: [number, number] | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (v: Viewport) => void;
  fitToPins?: boolean;
}) {
  const selected = pins.find((p) => p.id === selectedId);
  const focus = useMemo<[number, number] | null>(() => (selected ? [selected.latitude, selected.longitude] : null), [selected]);
  return (
    <MapContainer center={center} zoom={zoom} className="w-full h-full" zoomControl={false}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Recenter center={center} zoom={zoom} focus={focus} />
      <MoveWatcher onMove={onMove} />
      {fitToPins && <FitToPins pins={pins} />}
      {user && <CircleMarker center={user} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }} />}
      <MarkerClusterGroup showCoverageOnHover={false} maxClusterRadius={28} disableClusteringAtZoom={16} spiderfyOnMaxZoom>
        {pins.map((pin) => (
          <Marker key={pin.id} position={[pin.latitude, pin.longitude]}
            icon={pillIcon(priceText(pin), availabilityText(pin).tone === "now", pin.id === selectedId)}
            title={pin.title} alt={`${pin.title}, ${priceText(pin)}`}
            zIndexOffset={pin.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(pin.id) }} />
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}

export default memo(ExploreMap);
