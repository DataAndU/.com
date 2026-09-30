"use client";

import { TimeChips } from "@/components/time-chips";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, Truck, Users, XCircle } from "lucide-react";
import { AddressSearch, type GeocodedLocation } from "@/components/address-search";
import { useMe } from "@/lib/api/account";
import { fetchApi, type Listing, type Page } from "@/lib/api/client";

type Outcome = { label: string; ok: boolean; message: string };

function useNearby(category: "delivery" | "services", near: GeocodedLocation | null) {
  return useQuery<Page<Listing>>({
    queryKey: ["bundle-nearby", category, near?.latitude, near?.longitude],
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
      className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${selected ? "border-primary bg-primary/10" : "border-border hover:bg-foreground/5"}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">{listing.title}</span>
        <span className="text-primary">₹{listing.price}{listing.pricingMode === "negotiable" ? " · neg." : ""}</span>
      </span>
      <span className="text-xs text-muted-foreground">{listing.provider?.displayName} · {listing.distanceKm != null ? `${listing.distanceKm.toFixed(1)} km away` : listing.locationLabel}</span>
    </button>
  );
}

/** "Moving house" bundle: one form, several ordinary booking requests. */
export default function MovingBundlePage() {
  const { data: user } = useMe();
  const [from, setFrom] = useState<GeocodedLocation | null>(null);
  const [to, setTo] = useState<GeocodedLocation | null>(null);
  const [when, setWhen] = useState("");
  const [items, setItems] = useState("");
  const [note, setNote] = useState("");
  const [delivery, setDelivery] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [error, setError] = useState("");
  const tempos = useNearby("delivery", from);
  const helpers = useNearby("services", from);

  const listingTitle = (id: string) =>
    [...(tempos.data?.items || []), ...(helpers.data?.items || [])].find((l) => l.id === id)?.title || "Request";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!from || !to) return setError("Choose both the moving-from and moving-to addresses.");
    if (!when || Number.isNaN(new Date(when).getTime()) || new Date(when) <= new Date()) return setError("Pick a moving date and time in the future.");
    if (!delivery) return setError("Choose a delivery / tempo provider.");
    if (!items.trim()) return setError("Describe what needs moving.");
    const at = new Date(when).toISOString();
    const extra = note.trim() ? ` Note: ${note.trim()}` : "";
    setPending(true);
    const requests: { label: string; run: () => Promise<unknown> }[] = [
      { label: listingTitle(delivery), run: () => fetchApi("/bookings/delivery", { method: "POST", body: JSON.stringify({
        listingId: delivery, pickupAt: at, itemDescription: items.trim(), note: `Moving house bundle.${extra}`.slice(0, 1000),
        pickup: { label: from.label, latitude: from.latitude, longitude: from.longitude },
        dropoff: { label: to.label, latitude: to.latitude, longitude: to.longitude } }) }) },
      ...services.map((id) => ({ label: listingTitle(id), run: () => fetchApi("/bookings/services", { method: "POST", body: JSON.stringify({
        listingId: id, requestedAt: at,
        note: `Moving house bundle: ${from.label} → ${to.label}. Items: ${items.trim()}.${extra}`.slice(0, 1000) }) }) })),
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
    return <div className="p-8 text-center text-muted-foreground">The moving bundle is for buyer accounts.</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-border bg-card px-6 py-5">
        <div className="mx-auto max-w-3xl">
          <Link href="/categories" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Categories</Link>
          <h1 className="text-2xl font-bold">Moving house? Book everything at once</h1>
          <p className="text-sm text-muted-foreground">A tempo plus optional helpers or cleaners near you, in one go. Each provider gets a normal request and replies to you.</p>
        </div>
      </div>
      <div className="mx-auto max-w-3xl p-6">
        {outcomes ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Your moving requests</h2>
            {outcomes.map((o, i) => (
              <p key={i} className="flex items-center gap-2 text-sm">
                {o.ok ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                <span className="font-medium">{o.label}</span><span className="text-muted-foreground">— {o.message}</span>
              </p>
            ))}
            <Link href="/requests" className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">View my requests</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <section className="space-y-4 rounded-xl border border-border bg-card p-6">
              <AddressSearch label="Moving from" value={from} onChange={setFrom} />
              <AddressSearch label="Moving to" value={to} onChange={setTo} allowGps={false} />
              <label className="block text-sm">Moving date & time
                <TimeChips value={when} onPick={setWhen} />
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">What needs moving?
                <input value={items} onChange={(e) => setItems(e.target.value)} maxLength={300} placeholder="e.g. 1BHK: bed, fridge, 15 boxes" className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">Anything else? (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 h-20 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm" placeholder="Floor, lift, parking…" />
              </label>
            </section>

            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-3 flex items-center gap-2 font-semibold"><Truck className="h-5 w-5 text-primary" /> Tempo / delivery <span className="text-xs font-normal text-muted-foreground">(choose 1)</span></h2>
              {!from ? <p className="text-sm text-muted-foreground">Choose your moving-from address to see nearby providers.</p>
                : tempos.isLoading ? <p className="text-sm text-muted-foreground">Finding nearby tempos…</p>
                : !tempos.data?.items.length ? <p className="text-sm text-muted-foreground">No delivery providers within 25 km yet.</p>
                : <div className="grid gap-2 sm:grid-cols-2">{tempos.data.items.map((l) => <Choice key={l.id} listing={l} selected={delivery === l.id} onToggle={() => setDelivery(delivery === l.id ? null : l.id)} />)}</div>}
            </section>

            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-3 flex items-center gap-2 font-semibold"><Users className="h-5 w-5 text-primary" /> Helpers & cleaning <span className="text-xs font-normal text-muted-foreground">(optional, up to 3)</span></h2>
              {!from ? <p className="text-sm text-muted-foreground">Choose your moving-from address first.</p>
                : helpers.isLoading ? <p className="text-sm text-muted-foreground">Finding nearby services…</p>
                : !helpers.data?.items.length ? <p className="text-sm text-muted-foreground">No service providers within 25 km yet.</p>
                : <div className="grid gap-2 sm:grid-cols-2">{helpers.data.items.map((l) => <Choice key={l.id} listing={l} selected={services.includes(l.id)}
                    onToggle={() => setServices(services.includes(l.id) ? services.filter((x) => x !== l.id) : services.length < 3 ? [...services, l.id] : services)} />)}</div>}
            </section>

            {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-red-300">{error}</p>}
            <button type="submit" disabled={pending} className="w-full rounded-lg bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-send-bundle">
              {pending ? "Sending requests…" : `Send ${1 + services.length} request${services.length ? "s" : ""}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
