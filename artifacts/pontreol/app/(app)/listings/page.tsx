"use client";

import { ListingPhoto } from "@/components/listing-photo";
import { ListingForm, ListingFormPayload } from "@/components/listing-form";
import { useMe } from "@/lib/api/account";
import { useCreateListing, useDeleteListing, useMyListings, useUpdateListingStatus } from "@/lib/api/listings";
import { ExternalLink, List as ListIcon, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import type { Category } from "@/components/listing-form";

export default function MyListingsPage() {
  const { data: user, isLoading: userLoading } = useMe();
  const { data: listingsData, isLoading, error } = useMyListings();
  const createMutation = useCreateListing();
  const deleteMutation = useDeleteListing();
  const statusMutation = useUpdateListingStatus();
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [newCategory, setNewCategory] = useState<Category | undefined>(undefined);
  const queryClient = useQueryClient();
  const { data: earnings } = useQuery({
    queryKey: ["earnings"],
    queryFn: () => fetchApi<{ thisMonth: { jobs: number; amount: number }; lastMonth: { jobs: number; amount: number }; allTimeJobs: number }>("/me/earnings"),
    enabled: user?.role === "provider",
  });

  const startDeal = async (id: string) => {
    const percent = Number(window.prompt("Last-minute deal: how many % off? (5 to 70)", "20"));
    if (!percent) return;
    const hours = Number(window.prompt("For how many hours? (1 to 48)", "6"));
    if (!hours) return;
    setActionError("");
    try {
      await fetchApi(`/listings/${id}/deal`, { method: "PUT", body: JSON.stringify({ percent, hours }) });
      await queryClient.invalidateQueries();
    } catch (err) { setActionError(err instanceof Error ? err.message : "Could not start the deal."); }
  };

  const endDeal = async (id: string) => {
    setActionError("");
    try {
      await fetchApi(`/listings/${id}/deal`, { method: "DELETE" });
      await queryClient.invalidateQueries();
    } catch (err) { setActionError(err instanceof Error ? err.message : "Could not end the deal."); }
  };
  const [actionError, setActionError] = useState("");

  if (userLoading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (user?.role !== "provider") return <div className="p-8 text-center text-muted-foreground">Only providers can manage listings.</div>;

  const create = async (payload: ListingFormPayload) => {
    await createMutation.mutateAsync(payload);
    setIsCreating(false);
  };

  const changeStatus = async (id: string, status: "active" | "paused") => {
    const verb = status === "paused" ? "pause" : "activate";
    if (!window.confirm(`Are you sure you want to ${verb} this listing?`)) return;
    setActionError("");
    try {
      await statusMutation.mutateAsync({ id, status });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Unable to ${verb} the listing.`);
    }
  };

  const remove = async (id: string, title: string) => {
    if (!window.confirm(`Delete “${title}”? This removes it from the marketplace and cannot be undone.`)) return;
    setActionError("");
    try {
      await deleteMutation.mutateAsync({ id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to delete the listing.");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 border-b border-border bg-card px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Listings</h1>
          <p className="text-xs text-muted-foreground">Earn from what you already own — list it on Pontreol.</p>
        </div>
        {!isCreating && (
          <button onClick={() => { setNewCategory(undefined); setIsCreating(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> Create Listing
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto">
          {(error || actionError) && <div role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error?.message || actionError}</div>}
          {isLoading && <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mt-10" />}
          {!isCreating && earnings && (
            <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="earnings-summary">
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
                <p className="text-xs text-muted-foreground">Earned this month</p>
                <p className="text-2xl font-bold">₹{earnings.thisMonth.amount.toLocaleString("en-IN")}</p>
                <p className="text-xs text-muted-foreground">{earnings.thisMonth.jobs} completed {earnings.thisMonth.jobs === 1 ? "job" : "jobs"}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Last month</p>
                <p className="text-2xl font-bold">₹{earnings.lastMonth.amount.toLocaleString("en-IN")}</p>
                <p className="text-xs text-muted-foreground">{earnings.lastMonth.jobs} jobs · {earnings.allTimeJobs} jobs in total</p>
              </div>
              <button onClick={() => { setNewCategory("travel"); setIsCreating(true); }} className="rounded-xl border border-primary/40 bg-primary/10 p-4 text-left hover:border-primary">
                <p className="font-semibold">🚗 Going somewhere?</p>
                <p className="text-xs text-muted-foreground">Offer empty seats or boot space for parcels on your route.</p>
              </button>
            </div>
          )}
          {isCreating ? (
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">New Listing</h2>
                <button onClick={() => setIsCreating(false)} className="p-2 hover:bg-foreground/5 rounded-full" aria-label="Close form"><X className="w-5 h-5" /></button>
              </div>
              <ListingForm defaultCategory={newCategory} mutationPending={createMutation.isPending} onSubmit={create} onCancel={() => setIsCreating(false)} />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {listingsData?.items.map((listing) => (
                <div key={listing.id} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col">
                  <div className="aspect-video bg-input flex items-center justify-center relative">
                    {listing.photos?.length ? <ListingPhoto photo={listing.photos[0]} className="w-full h-full object-cover" /> : <ListIcon className="w-10 h-10 text-muted-foreground opacity-30" />}
                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur text-white text-xs px-2 py-1 rounded">{listing.status}</div>
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <span className="text-xs font-medium text-primary uppercase mb-1">{listing.category}</span>
                    <h3 className="font-semibold text-lg line-clamp-1">{listing.title}</h3>
                    <div className="text-muted-foreground text-sm mb-4 line-clamp-2">{listing.description}</div>
                    <div className="mt-auto flex items-center justify-between">
                      <span className="font-bold text-lg">₹{listing.price}{listing.dealPercent ? <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-xs text-black">{listing.dealPercent}% off</span> : null}</span>
                      <button className="px-4 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-xs font-medium" onClick={() => router.push(`/listings/${listing.id}/edit`)}>Edit</button>
                    </div>
                    <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2">
                      <button onClick={() => router.push(`/discover/${listing.id}`)} className="inline-flex items-center justify-center gap-1 text-xs py-1.5 bg-background border border-border rounded"><ExternalLink className="w-3 h-3" /> Details</button>
                      <button onClick={() => changeStatus(listing.id, listing.status === "active" ? "paused" : "active")} disabled={statusMutation.isPending} className="text-xs py-1.5 bg-background border border-border rounded disabled:opacity-50">{listing.status === "active" ? "Pause" : "Activate"}</button>
                      <button onClick={() => router.push(`/listings/${listing.id}/availability`)} className="text-xs py-1.5 bg-background border border-border rounded">Schedule</button>
                      {listing.dealPercent ? (
                        <button onClick={() => endDeal(listing.id)} className="text-xs py-1.5 bg-amber-500/15 border border-amber-500/40 text-amber-300 rounded">End deal</button>
                      ) : (
                        <button onClick={() => startDeal(listing.id)} disabled={listing.status !== "active"} className="text-xs py-1.5 bg-background border border-border rounded disabled:opacity-50">⚡ Last-minute deal</button>
                      )}
                      <button onClick={() => remove(listing.id, listing.title)} disabled={deleteMutation.isPending} className="inline-flex items-center justify-center gap-1 text-xs py-1.5 border border-red-500/40 text-red-300 rounded disabled:opacity-50"><Trash2 className="w-3 h-3" /> Delete</button>
                    </div>
                  </div>
                </div>
              ))}
              {!isLoading && !listingsData?.items.length && (
                <div className="col-span-full py-20 text-center border border-dashed border-border rounded-xl bg-card/50">
                  <ListIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-muted-foreground">You haven&apos;t created any listings yet.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}