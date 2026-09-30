"use client";

import { ListingPhoto } from "@/components/listing-photo";
import { ProviderBadges } from "@/components/provider-badges";
import { useProvider } from "@/lib/api/account";
import { ArrowLeft, Star, MapPin, CheckCircle2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";

export default function ProviderProfilePage() {
  // Next 16 passes `params` to pages as a Promise; read route params via the hook.
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading } = useProvider(params.id);

  if (isLoading) return <div className="p-8 flex justify-center"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  if (!data?.provider) return <div className="p-8 text-center">Provider not found</div>;

  const { provider, listings, reviews } = data;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-foreground/5 rounded-full"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold truncate">Provider Profile</h1>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          
          <div className="bg-card border border-border rounded-xl p-8 shadow-sm flex flex-col md:flex-row items-center md:items-start gap-6">
            {provider.avatarUrl
              ? <img src={provider.avatarUrl} alt="" className="w-24 h-24 rounded-full object-cover" referrerPolicy="no-referrer" />
              : <div className="w-24 h-24 shrink-0 rounded-full bg-secondary flex items-center justify-center text-4xl font-bold">{(provider.displayName || "?").slice(0, 1).toUpperCase()}</div>}
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-2xl font-bold flex items-center justify-center md:justify-start gap-2">
                {provider.displayName}
                {provider.verificationStatus === "verified" && <CheckCircle2 className="w-5 h-5 text-primary" />}
              </h2>
              <div className="flex items-center justify-center md:justify-start gap-4 mt-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 fill-primary text-primary" />
                  <span className="font-medium text-foreground">{provider.rating.toFixed(1)}</span>
                  <span>({provider.reviewCount} reviews)</span>
              {provider.availableNow && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-400">● Available now</span>}
                </div>
              </div>
              <div className="mt-3 flex justify-center md:justify-start"><ProviderBadges badges={provider.badges} /></div>

              {(provider.contactEmail || provider.contactPhone) && (
                <div className="mt-4 p-4 bg-background border border-border rounded-lg inline-block text-left">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Contact Info</h4>
                  {provider.contactEmail && <div className="text-sm">{provider.contactEmail}</div>}
                  {provider.contactPhone && <div className="text-sm">{provider.contactPhone}</div>}
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xl font-bold mb-4">Listings by {provider.displayName}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {listings?.map(listing => (
                <div key={listing.id} onClick={() => router.push(`/discover/${listing.id}`)} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col group cursor-pointer hover:border-primary/50 transition-colors">
                  <div className="aspect-video bg-input relative overflow-hidden">
                    {listing.photos && listing.photos.length > 0 ? (
                      <ListingPhoto photo={listing.photos[0]} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">No Image</div>
                    )}
                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur text-white text-[10px] uppercase font-bold px-2 py-1 rounded">
                      {listing.category}
                    </div>
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-semibold text-lg line-clamp-1 mb-1">{listing.title}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate">{listing.locationLabel}</span>
                    </div>
                    <div className="mt-auto flex items-center justify-between">
                      <span className="font-bold text-lg leading-tight">₹{listing.price}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{listing.pricingMode}</span>
                    </div>
                  </div>
                </div>
              ))}
              {(!listings || listings.length === 0) && (
                <div className="col-span-full p-8 text-center text-muted-foreground border border-dashed border-border rounded-xl bg-card/50">
                  No active listings.
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xl font-bold mb-4">Reviews</h3>
            <div className="space-y-4">
              {reviews?.map(review => (
                <div key={review.id} className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-4 h-4 ${i < review.rating ? 'fill-primary text-primary' : 'text-muted-foreground opacity-30'}`} />
                    ))}
                    <span className="text-xs text-muted-foreground ml-2">{format(new Date(review.createdAt), "PP")}</span>
                  </div>
                  <p className="text-sm leading-relaxed">{review.comment}</p>
                  {(review as { photoUrls?: string[] }).photoUrls?.length ? (
                    <div className="mt-3 flex gap-2">
                      {(review as { photoUrls?: string[] }).photoUrls!.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt="Review photo" loading="lazy" className="h-20 w-20 rounded-lg object-cover border border-border" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {(!reviews || reviews.length === 0) && (
                <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-xl bg-card/50">
                  No reviews yet.
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}