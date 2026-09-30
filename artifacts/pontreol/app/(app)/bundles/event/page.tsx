"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Building2, CheckCircle2, Users, XCircle } from "lucide-react";
import { AddressSearch, type GeocodedLocation } from "@/components/address-search";
import { useMe } from "@/lib/api/account";
import { fetchApi, type Listing, type Page } from "@/lib/api/client";

type Outcome = { label: string; ok: boolean; message: string };

const PACKS = {
  wedding: { title: "Wedding pack", emoji: "💍", hint: "Hall + cook + decorator + photographer, in one go.", placeholder: "e.g. 300 guests, veg lunch, mehendi decor" },
  festival: { title: "Festival pack", emoji: "🪔", hint: "Decorators, cooks and extra help for Diwali, Pongal, Onam, Eid or any festival.", placeholder: "e.g. Diwali lights, sweets for 50 people" },
  party: { title: "Party / function pack", emoji: "🎉", hint: "Birthday, naming ceremony or house-warming: venue and helpers together.", placeholder: "e.g. Birthday for 40 people, cake and snacks" },
} as const;
type PackKey = keyof typeof PACKS;

function useNearby(category: "spaces" | "services", near: GeocodedLocation | null) {
  return useQuery<Page<Listing>>({
    queryKey: ["event-nearby", category, near?.latitude, near?.longitude],
    queryFn: () => fetchApi(`/listings?${new URLSearchParams({
      category, lat: String(near!.latitude), lng: String(near!.longitude),
      distanceKm: "25", sort: "distance", limit: "12",
    })}`),
    enabled: !!near,
  });
}

function Choice({ listing, selected, onToggle }: { listing: Listing; selected: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={selected}
      className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${selected ? "border-primary bg-primary/10" : "border-border hover:bg-white/5"}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">{listing.title}</span>
        <span className="text-primary">₹{listing.dealPrice ?? listing.price}</span>
      </span>
      <span className="text-xs text-muted-foreground">{listing.provider?.displayName} · {listing.distanceKm != null ? `${listing.distanceKm.toFixed(1)} km away` : listing.locationLabel}</span>
    </button>
  );
}

/** Wedding / festival / party pack: one form, several ordinary booking requests. */
export default function EventPackPage() {
  const { data: user } = useMe();
  const [pack, setPack] = useState<PackKey>("wedding");
  const [near, setNear] = useState<GeocodedLocation | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [details, setDetails] = useState("");
  const [venue, setVenue] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [error, setError] = useState("");
  const venues = useNearby("spaces", near);
  const helpers = useNearby("services", near);

  useEffect(() => {
    const type = new URLSearchParams(window.location.search).get("type");
    if (type && type in PACKS) setPack(type as PackKey);
  }, []);

  const info = PACKS[pack];
  const titleOf = (id: string) =>
    [...(venues.data?.items || []), ...(helpers.data?.items || [])].find((l) => l.id === id)?.title || "Request";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!near) return setError("Choose where the event is.");
    const from = new Date(start), to = new Date(end);
    if (!start || Number.isNaN(from.getTime()) || from <= new Date()) return setError("Pick a start date and time in the future.");
    if (!end || Number.isNaN(to.getTime()) || to <= from) return setError("The end must be after the start.");
    if (!venue && !services.length) return setError("Choose a venue or at least one service.");
    if (!details.trim()) return setError("Tell providers a little about the event.");
    const note = `${info.title}: ${details.trim()}`.slice(0, 1000);
    setPending(true);
    const requests: { label: string; run: () => Promise<unknown> }[] = [
      ...(venue ? [{ label: titleOf(venue), run: () => fetchApi("/bookings/spaces", { method: "POST", body: JSON.stringify({
        listingId: venue, mode: "hourly", checkIn: from.toISOString(), checkOut: to.toISOString(), note }) }) }] : []),
      ...services.map((id) => ({ label: titleOf(id), run: () => fetchApi("/bookings/services", { method: "POST", body: JSON.stringify({
        listingId: id, requestedAt: from.toISOString(), note: `${note} · At: ${near.label}`.slice(0, 1000) }) }) })),
    ];
    const results = await Promise.allSettled(requests.map((r) => r.run()));
    setOutcomes(results.map((result, i) => ({
      label: requests[i].label,
      ok: result.status === "fulfilled",
      message: result.status === "fulfilled" ? "Request sent" : (result.reason instanceof Error ? result.reason.message : "Failed"),
    })));
    setPending(false);
  }

  if (user && user.role !== "buyer") {
    return <div className="p-8 text-center text-muted-foreground">Event packs are for customer accounts.</div>;
  }

  const count = (venue ? 1 : 0) + services.length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-border bg-card px-6 py-5">
        <div className="mx-auto max-w-3xl">
          <Link href="/categories" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Categories</Link>
          <div className="mb-3 flex flex-wrap gap-2">
            {(Object.keys(PACKS) as PackKey[]).map((key) => (
              <button key={key} type="button" onClick={() => setPack(key)} aria-pressed={pack === key}
                className={`rounded-full px-3 py-1 text-sm font-medium border ${pack === key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>
                {PACKS[key].emoji} {PACKS[key].title}
              </button>
            ))}
          </div>
          <h1 className="text-2xl font-bold">{info.emoji} {info.title}</h1>
          <p className="text-sm text-muted-foreground">{info.hint} Each provider gets a normal request and replies to you.</p>
        </div>
      </div>
      <div className="mx-auto max-w-3xl p-6">
        {outcomes ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Your requests</h2>
            {outcomes.map((o, i) => (
              <p key={i} className="flex items-center gap-2 text-sm">
                {o.ok ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                <span className="font-medium">{o.label}</span><span className="text-muted-foreground">: {o.message}</span>
              </p>
            ))}
            <Link href="/requests" className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">View my requests</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <section className="space-y-4 rounded-xl border border-border bg-card p-6">
              <AddressSearch label="Where is the event?" value={near} onChange={setNear} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">Starts
                  <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm" />
                </label>
                <label className="block text-sm">Ends
                  <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm" />
                </label>
              </div>
              <label className="block text-sm">About the event
                <input value={details} onChange={(e) => setDetails(e.target.value)} maxLength={400} placeholder={info.placeholder} className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm" />
              </label>
            </section>

            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-3 flex items-center gap-2 font-semibold"><Building2 className="h-5 w-5 text-primary" /> Venue / hall <span className="text-xs font-normal text-muted-foreground">(optional, choose 1)</span></h2>
              {!near ? <p className="text-sm text-muted-foreground">Choose the event location to see nearby halls.</p>
                : venues.isLoading ? <p className="text-sm text-muted-foreground">Finding nearby halls…</p>
                : !venues.data?.items.length ? <p className="text-sm text-muted-foreground">No halls or spaces within 25 km yet.</p>
                : <div className="grid gap-2 sm:grid-cols-2">{venues.data.items.map((l) => <Choice key={l.id} listing={l} selected={venue === l.id} onToggle={() => setVenue(venue === l.id ? null : l.id)} />)}</div>}
            </section>

            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-3 flex items-center gap-2 font-semibold"><Users className="h-5 w-5 text-primary" /> Cooks, decorators, photographers… <span className="text-xs font-normal text-muted-foreground">(up to 5)</span></h2>
              {!near ? <p className="text-sm text-muted-foreground">Choose the event location first.</p>
                : helpers.isLoading ? <p className="text-sm text-muted-foreground">Finding nearby services…</p>
                : !helpers.data?.items.length ? <p className="text-sm text-muted-foreground">No service providers within 25 km yet.</p>
                : <div className="grid gap-2 sm:grid-cols-2">{helpers.data.items.map((l) => <Choice key={l.id} listing={l} selected={services.includes(l.id)}
                    onToggle={() => setServices(services.includes(l.id) ? services.filter((x) => x !== l.id) : services.length < 5 ? [...services, l.id] : services)} />)}</div>}
            </section>

            {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-red-300">{error}</p>}
            <button type="submit" disabled={pending || count === 0} className="w-full rounded-lg bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-send-event-pack">
              {pending ? "Sending requests…" : `Send ${count} request${count === 1 ? "" : "s"}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
