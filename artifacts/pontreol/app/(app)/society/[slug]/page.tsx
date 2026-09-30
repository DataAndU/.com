"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building, Star, ThumbsUp } from "lucide-react";
import { ProviderBadges } from "@/components/provider-badges";
import { fetchApi, type ProviderSummary } from "@/lib/api/client";

type Society = { slug: string; name: string | null; helpers: { provider: ProviderSummary; recommendations: number; recommendedByMe: boolean }[] };

export default function SocietyPage() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [typedName, setTypedName] = useState("");
  const [error, setError] = useState("");
  const society = useQuery<Society>({ queryKey: ["society", slug], queryFn: () => fetchApi(`/societies/${slug}`) });
  const used = useQuery<{ items: ProviderSummary[] }>({ queryKey: ["used-providers"], queryFn: () => fetchApi("/me/used-providers") });

  useEffect(() => { setTypedName(new URLSearchParams(window.location.search).get("name") || ""); }, []);
  const name = society.data?.name || typedName || slug.replace(/-/g, " ");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["society", slug] });
  const recommend = async (providerId: string) => {
    setError("");
    try { await fetchApi("/societies/recommend", { method: "POST", body: JSON.stringify({ societyName: name, providerId }) }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not recommend"); }
  };
  const withdraw = async (providerId: string) => {
    setError("");
    try { await fetchApi(`/societies/${slug}/recommend/${providerId}`, { method: "DELETE" }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not remove"); }
  };

  const recommendedIds = new Set(society.data?.helpers.filter((h) => h.recommendedByMe).map((h) => h.provider.id));
  const canAdd = (used.data?.items || []).filter((p) => !recommendedIds.has(p.id));
  const shareText = `Trusted helpers in ${name}, recommended by our neighbours on Pontreol: ${typeof window !== "undefined" ? window.location.origin : "https://pontreol.com"}/society/${slug}`;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="flex items-center gap-3"><Building className="h-7 w-7 text-primary" /><h1 className="text-2xl font-bold capitalize">{name}</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Helpers recommended by residents. Only people who completed a job with a helper can recommend them, and residents&apos; names are never shown.</p>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-block rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white">Share in society WhatsApp group</a>
        </div>

        {error && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        <section className="space-y-3">
          {society.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
            : !society.data?.helpers.length ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No recommendations yet. Be the first. Recommend a helper you have used below.</p>
            : society.data.helpers.map(({ provider, recommendations, recommendedByMe }) => (
              <div key={provider.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div className="min-w-0">
                  <Link href={`/providers/${provider.id}`} className="font-semibold hover:text-primary">{provider.displayName}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5 text-primary" /> {recommendations} {recommendations === 1 ? "neighbour" : "neighbours"}</span>
                    {provider.reviewCount > 0 && <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" /> {provider.rating.toFixed(1)}</span>}
                    {provider.availableNow && <span className="text-emerald-400">● Free now</span>}
                  </div>
                  <div className="mt-1"><ProviderBadges badges={provider.badges} /></div>
                </div>
                {recommendedByMe && <button onClick={() => withdraw(provider.id)} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs">Remove my recommendation</button>}
              </div>
            ))}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Recommend a helper you have used</h2>
          {!canAdd.length ? <p className="mt-2 text-sm text-muted-foreground">After you complete a booking with someone on Pontreol, you can recommend them here.</p>
            : <div className="mt-3 flex flex-wrap gap-2">{canAdd.map((p) => (
                <button key={p.id} onClick={() => recommend(p.id)} className="rounded-full border border-primary/50 px-3 py-1.5 text-sm hover:bg-primary/10">👍 {p.displayName}</button>
              ))}</div>}
        </section>
      </div>
    </div>
  );
}
