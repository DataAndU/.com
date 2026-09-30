"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { List, Map as MapIcon, Navigation, Search, X } from "lucide-react";
import { fetchApi } from "@/lib/api/client";
import type { HomeSummary, MapPin } from "@/lib/api/listings";
import { useUserLocation } from "@/lib/geolocation";
import { availabilityText, CATEGORY_LABEL, distanceText, priceText } from "@/lib/availability";
import type { Viewport } from "@/components/explore-map";
import { VoiceSearchButton } from "@/components/voice-search-button";

const loadMap = () => import("@/components/explore-map");
const ExploreMap = dynamic(loadMap, { ssr: false, loading: () => <div className="h-full w-full bg-muted" /> });

// Neutral India overview when no location is known (display only, never sent as the user's position).
const OVERVIEW: [number, number] = [22.35, 78.67];
const CATEGORIES = ["services", "spaces", "delivery", "travel"] as const;
type When = "any" | "now" | "today";

function windowFor(when: When): { windowFrom: string; windowTo: string } | null {
  if (when === "any") return null;
  const from = new Date();
  const to = new Date(from);
  if (when === "now") to.setMinutes(to.getMinutes() + 1);
  else to.setHours(23, 59, 59, 0);
  return { windowFrom: from.toISOString(), windowTo: to.toISOString() };
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}

function Availability({ pin, large = false }: { pin: MapPin; large?: boolean }) {
  const a = availabilityText(pin);
  return (
    <div className={large ? "text-base" : "text-sm"}>
      <p className={`font-semibold ${a.tone === "now" ? "text-emerald-600 dark:text-emerald-400" : a.tone === "later" ? "text-foreground" : "text-muted-foreground"}`}>
        {a.tone === "now" && <span aria-hidden="true">🟢 </span>}{a.main}
      </p>
      {a.sub && <p className="text-muted-foreground text-xs">{a.sub}</p>}
    </div>
  );
}

function ResultRow({ pin, selected, onSelect }: { pin: MapPin; selected: boolean; onSelect: () => void }) {
  const distance = distanceText(pin.distanceKm);
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className={`w-full text-left px-4 py-3.5 border-b border-border flex items-start gap-3 ${selected ? "bg-primary/10" : "hover:bg-foreground/5"}`}>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{pin.title}</p>
          <Availability pin={pin} />
          <p className="mt-0.5 text-xs text-muted-foreground">{CATEGORY_LABEL[pin.category]}{distance ? ` · ${distance}` : ""}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold">{priceText(pin)}</p>
          {pin.dealPercent ? <p className="text-xs text-amber-600">{pin.dealPercent}% off today</p> : null}
        </div>
      </button>
    </li>
  );
}

export default function ExplorePage() {
  const { state: location, locate, setSearched } = useUserLocation();
  const coords = location.status === "ready" ? location.coords : null;

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [when, setWhen] = useState<When>("any");
  const [nearby, setNearby] = useState(false);
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [area, setArea] = useState<Viewport | null>(null);
  const [radiusKm, setRadiusKm] = useState(15);
  const [placeText, setPlaceText] = useState("");
  const [placeError, setPlaceError] = useState("");

  // Links like /home?q=plumber&when=now&category=spaces open with those filters.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("q")) setQuery(p.get("q")!);
    const c = p.get("category");
    if (c && (CATEGORIES as readonly string[]).includes(c)) setCategory(c);
    const w = p.get("when");
    if (w === "now" || w === "today") setWhen(w);
  }, []);

  useEffect(() => { void loadMap(); }, []);
  // A new GPS/searched position resets the map area to it.
  useEffect(() => { if (coords) setArea(null); }, [coords?.lat, coords?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = useDebounced(query.trim(), 350);
  const center = area ?? (coords ? { lat: coords.lat, lng: coords.lng, radiusKm } : null);
  const effectiveRadius = nearby ? Math.min(5, center?.radiusKm ?? 5) : (center?.radiusKm ?? radiusKm);
  const round = (v: number) => Math.round(v * 100) / 100;
  const params = useMemo(() => {
    const p: Record<string, string> = { view: "map" };
    if (center) {
      p.lat = String(round(center.lat)); p.lng = String(round(center.lng));
      p.distanceKm = String(Math.round(effectiveRadius));
    }
    if (search) p.search = search;
    if (category) p.category = category;
    const w = windowFor(when);
    if (w) Object.assign(p, w);
    return p;
  // windowFor uses the current time: recompute only when inputs change.
  }, [center?.lat, center?.lng, effectiveRadius, search, category, when]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, isFetching, error } = useQuery<HomeSummary>({
    queryKey: ["explore", { ...params, windowFrom: undefined, windowTo: undefined, when }],
    queryFn: () => fetchApi(`/home/summary?${new URLSearchParams(params)}`),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
  const pins = useMemo(() => data?.nearbyListings ?? [], [data]);
  const selected = pins.find((p) => p.id === selectedId) ?? null;

  const onMove = useCallback((v: Viewport) => setArea(v), []);
  const mapCenter: [number, number] = coords ? [coords.lat, coords.lng] : OVERVIEW;
  const mapZoom = coords ? 13 : 5;

  const findPlace = async (event: React.FormEvent) => {
    event.preventDefault();
    setPlaceError("");
    if (placeText.trim().length < 3) return;
    try {
      const r = await fetchApi<{ results: { latitude: number; longitude: number }[] }>(`/geocode?q=${encodeURIComponent(placeText.trim())}`);
      if (!r.results.length) return setPlaceError("Place not found. Try a nearby area or city.");
      setSearched({ lat: r.results[0].latitude, lng: r.results[0].longitude });
      setPlaceText("");
    } catch (e) { setPlaceError(e instanceof Error ? e.message : "Could not find that place."); }
  };

  const chip = (active: boolean) =>
    `shrink-0 h-9 rounded-full px-4 text-sm font-medium border transition-colors ${active ? "bg-foreground text-background border-foreground" : "border-border bg-background text-foreground"}`;

  const empty = !isLoading && !error && pins.length === 0;
  const results = (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {error ? (
        <p role="alert" className="p-6 text-sm text-muted-foreground">Could not load listings. {error instanceof Error ? error.message : ""}</p>
      ) : empty ? (
        <div className="p-8 text-center">
          <p className="font-semibold">Nothing available here {when === "now" ? "right now" : when === "today" ? "today" : "yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">Try another time or search a larger area.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" className={chip(false)} onClick={() => { setNearby(false); setRadiusKm(100); setArea((a) => (a ? { ...a, radiusKm: 100 } : a)); }}>Expand area</button>
            {when !== "any" && <button type="button" className={chip(false)} onClick={() => setWhen("any")}>Any time</button>}
          </div>
        </div>
      ) : (
        <ul>{pins.map((pin) => <ResultRow key={pin.id} pin={pin} selected={pin.id === selectedId} onSelect={() => setSelectedId(pin.id)} />)}</ul>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search + filters */}
      <div className="shrink-0 border-b border-border bg-background px-4 pt-3 pb-2 space-y-2.5">
        <p className="hidden md:block text-sm text-muted-foreground">Find what’s available, where and when.</p>
        <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 h-12">
          <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What do you need?" aria-label="What do you need?"
            className="flex-1 min-w-0 bg-transparent text-base focus:outline-none" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-4 w-4 text-muted-foreground" /></button>}
          <VoiceSearchButton onText={setQuery} />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-4 px-4" role="group" aria-label="When and where">
          <button type="button" className={chip(when === "now")} aria-pressed={when === "now"} onClick={() => setWhen(when === "now" ? "any" : "now")}>Now</button>
          <button type="button" className={chip(when === "today")} aria-pressed={when === "today"} onClick={() => setWhen(when === "today" ? "any" : "today")}>Today</button>
          <button type="button" className={chip(nearby)} aria-pressed={nearby}
            onClick={() => { if (!coords) locate(); setNearby(!nearby); }}>Nearby</button>
          <span className="w-px shrink-0 bg-border mx-1" aria-hidden="true" />
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className={chip(category === c)} aria-pressed={category === c}
              onClick={() => setCategory(category === c ? null : c)}>{CATEGORY_LABEL[c]}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <form onSubmit={findPlace} className="flex flex-1 min-w-0 items-center gap-1.5">
            <button type="button" onClick={locate} className="p-1 text-primary" aria-label="Use my location"><Navigation className="h-4 w-4" /></button>
            <input value={placeText} onChange={(e) => setPlaceText(e.target.value)}
              placeholder={coords ? (location.status === "ready" && location.source === "gps" ? "Near you · change area" : "Chosen area · change") : "Type your area or city"}
              aria-label="Area or city" className="flex-1 min-w-0 bg-transparent py-1 focus:outline-none" />
          </form>
          <span aria-live="polite">{isFetching ? "Updating…" : data ? `${pins.length} result${pins.length === 1 ? "" : "s"}` : ""}</span>
          <div className="md:hidden flex rounded-lg border border-border overflow-hidden" role="group" aria-label="View">
            <button type="button" onClick={() => setView("map")} aria-pressed={view === "map"} className={`px-2.5 py-1 flex items-center gap-1 ${view === "map" ? "bg-foreground text-background" : ""}`}><MapIcon className="h-3.5 w-3.5" />Map</button>
            <button type="button" onClick={() => setView("list")} aria-pressed={view === "list"} className={`px-2.5 py-1 flex items-center gap-1 ${view === "list" ? "bg-foreground text-background" : ""}`}><List className="h-3.5 w-3.5" />List</button>
          </div>
        </div>
        {(placeError || location.status === "denied") && (
          <p className="text-xs text-muted-foreground">{placeError || "Location is off. Type your area above to see what’s near it."}</p>
        )}
      </div>

      {/* Desktop: results 38% | map 62%. Mobile: map or list. */}
      <div className="flex-1 min-h-0 flex relative">
        <div className={`${view === "list" ? "flex" : "hidden"} md:flex flex-col w-full md:w-[38%] md:max-w-md md:border-r border-border min-h-0`}>
          {results}
        </div>
        <div className={`${view === "map" ? "block" : "hidden"} md:block flex-1 min-h-0 relative z-0`}>
          <ExploreMap pins={pins} center={mapCenter} zoom={mapZoom} user={coords ? [coords.lat, coords.lng] : null}
            selectedId={selectedId} onSelect={setSelectedId} onMove={onMove} fitToPins={!coords && !area} />
          {empty && view === "map" && (
            <div className="md:hidden absolute inset-x-3 top-3 z-[500] rounded-xl bg-card border border-border p-3 text-center text-sm shadow">
              Nothing available here{when === "now" ? " right now" : when === "today" ? " today" : ""}.{" "}
              <button type="button" className="font-semibold text-primary" onClick={() => { setNearby(false); setWhen("any"); setRadiusKm(100); setArea((a) => (a ? { ...a, radiusKm: 100 } : a)); }}>Expand area · Any time</button>
            </div>
          )}
          {selected && (
            <div className="absolute inset-x-3 bottom-3 z-[500] rounded-2xl bg-card border border-border shadow-lg p-4" role="dialog" aria-label={selected.title}>
              <button type="button" onClick={() => setSelectedId(null)} className="absolute right-2 top-2 p-1.5 text-muted-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
              <p className="text-xs text-muted-foreground">{CATEGORY_LABEL[selected.category]}</p>
              <p className="pr-6 text-lg font-semibold leading-tight">{selected.title}</p>
              <div className="mt-1"><Availability pin={selected} large /></div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {distanceText(selected.distanceKm) ? <>{distanceText(selected.distanceKm)} · </> : null}
                  <span className="text-base font-semibold text-foreground">{priceText(selected)}</span>
                </p>
                <Link href={`/discover/${selected.id}`} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">View →</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
