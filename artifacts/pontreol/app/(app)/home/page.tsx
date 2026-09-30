"use client";
import { Overlay } from "@/components/overlay";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { List, Map as MapIcon, Navigation, Search, X } from "lucide-react";
import { fetchApi } from "@/lib/api/client";
import type { HomeSummary, MapPin } from "@/lib/api/listings";
import { useUserLocation } from "@/lib/geolocation";
import { availabilityText, CATEGORY_LABEL, distanceText, priceText } from "@/lib/availability";
import type { Viewport } from "@/components/explore-map";
import { useT } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { Tutorial } from "@/components/tutorial";
import { OneTimeHint } from "@/components/one-time-hint";
import { hasSeen, markSeen, TUTORIAL } from "@/lib/onboarding";
import { VoiceSearchButton } from "@/components/voice-search-button";

const loadMap = () => import("@/components/explore-map");
const ExploreMap = dynamic(loadMap, { ssr: false, loading: () => <div className="h-full w-full bg-muted" /> });

// Neutral India overview when no location is known (display only, never sent as the user's position).
const OVERVIEW: [number, number] = [22.35, 78.67];
const CATEGORIES = ["services", "spaces", "travel"] as const;
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
  const t = useT();
  const a = availabilityText(pin);
  const main = a.main === "Available now" ? t("availableNow") : a.main === "Ask for times" ? t("askTimes") : a.main;
  return (
    <div className={large ? "text-base" : "text-sm"}>
      <p className={`font-semibold ${a.tone === "now" ? "text-emerald-600 dark:text-emerald-400" : a.tone === "later" ? "text-foreground" : "text-muted-foreground"}`}>
        {a.tone === "now" && <span aria-hidden="true">🟢 </span>}{main}
      </p>
      {a.sub && <p className="text-muted-foreground text-xs">{a.sub}</p>}
    </div>
  );
}

function ResultRow({ pin, selected, onSelect }: { pin: MapPin; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const distance = distanceText(pin.distanceKm);
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className={`w-full text-left px-4 py-3.5 border-b border-border flex items-start gap-3 ${selected ? "bg-primary/10" : "hover:bg-foreground/5"}`}>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{pin.title}</p>
          <Availability pin={pin} />
          <p className="mt-0.5 text-xs text-muted-foreground">{t(`cat.${pin.category}` as "cat.services")}{distance ? ` · ${distance}` : ""}</p>
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
  const t = useT();
  const { state: location, locate, setSearched } = useUserLocation();
  const coords = location.status === "ready" ? location.coords : null;

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [when, setWhen] = useState<When>("any");
  const [nearby, setNearby] = useState(false);
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedId, setSelectedIdRaw] = useState<string | null>(null);
  const router = useRouter();
  const [showTutorial, setShowTutorial] = useState(false);
  const [askLocation, setAskLocation] = useState(false);
  const dismissHint = useRef<((id: string) => void) | null>(null);
  const setSelectedId = useCallback((id: string | null) => {
    if (id) dismissHint.current?.("marker");
    setSelectedIdRaw(id);
  }, []);
  const [area, setArea] = useState<Viewport | null>(null);
  const [radiusKm, setRadiusKm] = useState(15);
  const [placeText, setPlaceText] = useState("");
  const [placeError, setPlaceError] = useState("");

  // Links like /home?q=plumber&when=now&category=spaces open with those filters.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // First visit on this device (or "How Pontreol works" from Profile).
    if (p.get("tutorial") === "1" || !hasSeen(TUTORIAL)) setShowTutorial(true);
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

  const onMove = useCallback((v: Viewport) => { dismissHint.current?.("move"); setArea(v); }, []);

  const finishTutorial = (next: "explore" | "post" | "skip") => {
    markSeen(TUTORIAL);
    setShowTutorial(false);
    if (next === "post") router.push("/listings?new=1");
  };

  // Location is only requested after a short explanation, when the user asks.
  const wantLocation = (thenNearby: boolean) => {
    if (coords) { if (thenNearby) setNearby(!nearby); return; }
    if (location.status === "denied") { setPlaceError("Location is blocked in your browser. Type your area instead."); return; }
    setAskLocation(true);
    if (thenNearby) setNearby(true);
  };
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
          <p className="font-semibold">{t("nothingHere")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("tryAnother")}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" className={chip(false)} onClick={() => { setNearby(false); setRadiusKm(100); setArea((a) => (a ? { ...a, radiusKm: 100 } : a)); }}>{t("expandArea")}</button>
            {when !== "any" && <button type="button" className={chip(false)} onClick={() => setWhen("any")}>{t("anyTime")}</button>}
          </div>
        </div>
      ) : (
        <ul>{pins.map((pin) => <ResultRow key={pin.id} pin={pin} selected={pin.id === selectedId} onSelect={() => setSelectedId(pin.id)} />)}</ul>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {showTutorial && <Tutorial onDone={finishTutorial} />}
      {askLocation && (
        <Overlay>
        <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Use your location">
          <div className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-2xl">
            <p className="text-3xl" aria-hidden="true">📍</p>
            <h2 className="mt-2 text-lg font-semibold">See what’s available near you</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pontreol can use your location to show nearby availability. It is not shared with other people.</p>
            <button type="button" onClick={() => { setAskLocation(false); locate(); }} className="mt-4 w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground" data-testid="location-allow">Use my location</button>
            <button type="button" onClick={() => { setAskLocation(false); setNearby(false); }} className="mt-2 w-full rounded-xl border border-border py-3 font-semibold" data-testid="location-not-now">Not now</button>
          </div>
        </div>
        </Overlay>
      )}
      {/* Search + filters */}
      <div className="shrink-0 border-b border-border bg-background px-4 pt-3 pb-2 space-y-2.5">
        <p className="hidden md:block text-sm text-muted-foreground">{t("tagline")}</p>
        <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 h-12">
          <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("whatNeed")} aria-label={t("whatNeed")}
            className="flex-1 min-w-0 bg-transparent text-base focus:outline-none" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-4 w-4 text-muted-foreground" /></button>}
          <VoiceSearchButton onText={setQuery} />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-4 px-4" role="group" aria-label="When and where">
          <button type="button" className={chip(when === "now")} aria-pressed={when === "now"} onClick={() => setWhen(when === "now" ? "any" : "now")}>{t("now")}</button>
          <button type="button" className={chip(when === "today")} aria-pressed={when === "today"} onClick={() => setWhen(when === "today" ? "any" : "today")}>{t("today")}</button>
          <button type="button" className={chip(nearby)} aria-pressed={nearby}
            onClick={() => (coords ? setNearby(!nearby) : wantLocation(true))}>{t("nearby")}</button>
          <span className="w-px shrink-0 bg-border mx-1" aria-hidden="true" />
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className={chip(category === c)} aria-pressed={category === c}
              onClick={() => setCategory(category === c ? null : c)}>{t(`cat.${c}`)}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <form onSubmit={findPlace} className="flex flex-1 min-w-0 items-center gap-1.5">
            <button type="button" onClick={() => wantLocation(false)} className="p-1 text-primary" aria-label="Use my location"><Navigation className="h-4 w-4" /></button>
            <input value={placeText} onChange={(e) => setPlaceText(e.target.value)}
              placeholder={coords ? (location.status === "ready" && location.source === "gps" ? t("nearYou") : "Chosen area · change") : t("typeArea")}
              aria-label="Area or city" className="flex-1 min-w-0 bg-transparent py-1 focus:outline-none" />
          </form>
          <span aria-live="polite">{isFetching ? "Updating…" : data ? `${pins.length} ${t("results")}` : ""}</span>
          <div className="md:hidden flex rounded-lg border border-border overflow-hidden" role="group" aria-label="View">
            <button type="button" onClick={() => setView("map")} aria-pressed={view === "map"} className={`px-2.5 py-1 flex items-center gap-1 ${view === "map" ? "bg-foreground text-background" : ""}`}><MapIcon className="h-3.5 w-3.5" />{t("map")}</button>
            <button type="button" onClick={() => setView("list")} aria-pressed={view === "list"} className={`px-2.5 py-1 flex items-center gap-1 ${view === "list" ? "bg-foreground text-background" : ""}`}><List className="h-3.5 w-3.5" />{t("list")}</button>
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
          {!showTutorial && !selected && !empty && pins.length > 0 && (
            <OneTimeHint className="absolute inset-x-3 bottom-3 z-[500]" dismissRef={dismissHint} hints={[
              { id: "marker", text: "Tap a marker to see availability and price." },
              { id: "move", text: "Move the map to discover availability in another area." },
            ]} />
          )}
          {empty && view === "map" && (
            <div className="md:hidden absolute inset-x-3 top-3 z-[500] rounded-xl bg-card border border-border p-3 text-center text-sm shadow">
              {t("nothingHere")}.{" "}
              <button type="button" className="font-semibold text-primary" onClick={() => { setNearby(false); setWhen("any"); setRadiusKm(100); setArea((a) => (a ? { ...a, radiusKm: 100 } : a)); }}>{t("expandArea")} · {t("anyTime")}</button>
            </div>
          )}
          {selected && (
            <div className="absolute inset-x-3 bottom-3 z-[500] rounded-2xl bg-card border border-border shadow-lg p-4" role="dialog" aria-label={selected.title}>
              <button type="button" onClick={() => setSelectedId(null)} className="absolute right-2 top-2 p-1.5 text-muted-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
              <p className="text-xs text-muted-foreground">{t(`cat.${selected.category}` as "cat.services")}</p>
              <p className="pr-6 text-lg font-semibold leading-tight">{selected.title}</p>
              <div className="mt-1"><Availability pin={selected} large /></div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {distanceText(selected.distanceKm) ? <>{distanceText(selected.distanceKm)} · </> : null}
                  <span className="text-base font-semibold text-foreground">{priceText(selected)}</span>
                </p>
                <Link href={`/discover/${selected.id}`} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">{t("view")} →</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
