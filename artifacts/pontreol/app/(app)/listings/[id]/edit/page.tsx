"use client";

import { ListingForm, ListingFormPayload } from "@/components/listing-form";
import { useListing, useUpdateListing } from "@/lib/api/listings";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export default function EditListingPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: listing, isLoading, error } = useListing(params.id);
  const updateMutation = useUpdateListing();

  if (isLoading) return <div className="p-8 flex justify-center"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  if (error) return <div className="p-8 text-center text-red-400">{error.message}</div>;
  if (!listing) return <div className="p-8 text-center">Listing not found.</div>;

  const update = async (payload: ListingFormPayload) => {
    const { category: _category, ...data } = payload;
    await updateMutation.mutateAsync({ id: listing.id, data });
    router.push("/listings");
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-white/5 rounded-full" aria-label="Go back"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold truncate">Edit listing</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto bg-card border border-border rounded-xl p-6 shadow-sm">
          <ListingForm initial={listing} mutationPending={updateMutation.isPending} onSubmit={update} onCancel={() => router.back()} />
        </div>
      </div>
    </div>
  );
}