"use client";
import { MarketplaceNotice } from "@/components/marketplace-notice";

import { ShareTrip } from "@/components/share-trip";
import { useBooking, useUpdateBookingStatus, useQuoteBooking, useQuoteResponse, useCompleteBooking, useCreateReview } from "@/lib/api/bookings";
import { format } from "date-fns";
import { BookingSteps } from "@/components/booking-steps";
import { BookingMoment } from "@/components/celebration";
import { useState } from "react";
import { ArrowLeft, Star } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useMe } from "@/lib/api/account";
import { uploadMedia } from "@/lib/api/listings";
import dynamic from "next/dynamic";

const RouteMap = dynamic(() => import("@/components/route-map"), { ssr: false });

// Booking details in plain words instead of raw data.
const LABELS: Record<string, string> = {
  requestedAt: "When", startsAt: "From", endsAt: "Until", checkIn: "Check-in", checkOut: "Check-out",
  pickupAt: "Pickup time", pickup: "Pickup", dropoff: "Drop-off", itemDescription: "What", seats: "Seats",
  note: "Note", mode: "Booking type", operatorRequested: "Operator needed",
};

function detailRows(details: Record<string, unknown> | null | undefined): [string, string][] {
  return Object.entries(details || {}).flatMap(([key, value]): [string, string][] => {
    if (value === null || value === undefined || value === "") return [];
    let text: string;
    if (typeof value === "boolean") text = value ? "Yes" : "No";
    else if (typeof value === "object" && value && "label" in value) text = String((value as { label: unknown }).label);
    else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) text = new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    else if (typeof value === "object") return [];
    else text = String(value);
    return [[LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), text]];
  });
}

export default function RequestDetailPage() {
  // Next 16 passes `params` to pages as a Promise; read route params via the hook.
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: user } = useMe();
  const { data, isLoading } = useBooking(params.id);
  
  const statusMutation = useUpdateBookingStatus();
  const quoteMutation = useQuoteBooking();
  const quoteResponseMutation = useQuoteResponse();
  const completeMutation = useCompleteBooking();
  const reviewMutation = useCreateReview();

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewPhotos, setReviewPhotos] = useState<{ id: string; preview: string }[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const addReviewPhotos = async (files: FileList | null) => {
    if (!files) return;
    setPhotoError(""); setPhotoBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 4 - reviewPhotos.length)) {
        const media = await uploadMedia(file, "reviewPhoto");
        setReviewPhotos((current) => [...current, { id: media.id, preview: URL.createObjectURL(file) }]);
      }
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Photo upload failed");
    } finally { setPhotoBusy(false); }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  if (!data?.booking) return <div className="p-8 text-center">Booking not found</div>;

  const booking = data.booking;
  const iAmProvider = user?.id === booking.providerId;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-background px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-foreground/5 rounded-full" aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
          <h1 className="text-lg font-semibold truncate">Booking</h1>
        </div>
        <BookingSteps status={booking.status} />
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <a href={`/discover/${booking.listingId}`} className="text-lg font-semibold hover:text-primary">View the listing →</a>
            <p className="mt-1 text-sm text-muted-foreground">Asked on {format(new Date(booking.createdAt), "d MMM, h:mm a")}</p>
            {booking.quotedPrice !== null && (
              <p className="mt-3 text-sm">Price offered: <span className="font-semibold text-primary text-lg">₹{booking.quotedPrice.toLocaleString("en-IN")}</span></p>
            )}

            <div className="mt-6"><BookingMoment status={booking.status} isBuyer={user?.id === booking.buyerId} /></div>
            <MarketplaceNotice className="mt-4" />
            <dl className="mt-6 divide-y divide-border rounded-lg border border-border text-sm">
              {detailRows(booking.details).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium break-words min-w-0">{value}</dd>
                </div>
              ))}
            </dl>

            {["travel", "services", "delivery"].includes(booking.category) && user?.id === booking.buyerId && !["declined", "cancelled"].includes(booking.status) && (
              <ShareTrip bookingId={booking.id} category={booking.category} />
            )}

            {/* Delivery specific route map */}
            {booking.category === "delivery" && data.route && (
              <RouteMap route={data.route} />
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-wrap gap-2">
            {booking.status === "requested" && iAmProvider && (
              <>
                <button 
                  onClick={() => statusMutation.mutate({ id: booking.id, status: "declined" })}
                  className="px-4 py-2 border border-destructive/50 text-destructive rounded-lg text-sm font-medium hover:bg-destructive/10"
                >
                  Decline
                </button>
                <button 
                  onClick={() => {
                    const val = prompt("Enter quote amount in INR:");
                    if (val && !isNaN(Number(val))) {
                      quoteMutation.mutate({ id: booking.id, quotedPrice: Number(val) });
                    }
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/90"
                >
                  Send Quote
                </button>
                <button 
                  onClick={() => statusMutation.mutate({ id: booking.id, status: "confirmed" })}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
                >
                  Accept
                </button>
              </>
            )}

            {booking.category === "delivery" && booking.status === "requested" && iAmProvider && (
              // Specific delivery transition
              <button 
                onClick={() => statusMutation.mutate({ id: booking.id, status: "pickedUp" })}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                Mark Picked Up
              </button>
            )}
            {booking.category === "delivery" && booking.status === "pickedUp" && iAmProvider && (
              <button 
                onClick={() => statusMutation.mutate({ id: booking.id, status: "enRoute" })}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                Mark En Route
              </button>
            )}
            {booking.category === "delivery" && booking.status === "enRoute" && iAmProvider && (
              <button 
                onClick={() => statusMutation.mutate({ id: booking.id, status: "delivered" })}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                Mark Delivered
              </button>
            )}

            {booking.status === "quoted" && !iAmProvider && (
              <>
                <button 
                  onClick={() => quoteResponseMutation.mutate({ id: booking.id, accept: false })}
                  className="px-4 py-2 border border-destructive/50 text-destructive rounded-lg text-sm font-medium hover:bg-destructive/10"
                >
                  Decline Quote
                </button>
                <button 
                  onClick={() => quoteResponseMutation.mutate({ id: booking.id, accept: true })}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
                >
                  Accept Quote
                </button>
              </>
            )}

            {booking.status === "confirmed" && (
              <button 
                onClick={() => completeMutation.mutate({ id: booking.id })}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                Mark as Completed
              </button>
            )}

            {(booking.status === "requested" || booking.status === "confirmed") && !iAmProvider && (
              <button 
                onClick={() => statusMutation.mutate({ id: booking.id, status: "cancelled" })}
                className="px-4 py-2 border border-destructive/50 text-destructive rounded-lg text-sm font-medium hover:bg-destructive/10"
              >
                Cancel Booking
              </button>
            )}
          </div>

          {booking.status === "completed" && user?.id === booking.buyerId && (
            <a href={`/discover/${booking.listingId}`} className="block text-center rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-500" data-testid="button-book-again">
              ↻ Book again
            </a>
          )}

          {booking.status === "completed" && (
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-bold mb-4">Leave a Review</h3>
              <div className="flex gap-2 mb-4">
                {[1,2,3,4,5].map(star => (
                  <button key={star} onClick={() => setRating(star)} className="p-1">
                    <Star className={`w-6 h-6 ${rating >= star ? 'fill-primary text-primary' : 'text-muted-foreground opacity-30'}`} />
                  </button>
                ))}
              </div>
              <textarea 
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Write your review here..."
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm h-24 mb-4"
              />
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">Add before / after photos (optional, up to 4)</p>
                <div className="flex flex-wrap gap-2">
                  {reviewPhotos.map((p) => (
                    <img key={p.id} src={p.preview} alt="" className="h-20 w-20 rounded-lg object-cover border border-border" />
                  ))}
                  {reviewPhotos.length < 4 && (
                    <label className="h-20 w-20 rounded-lg border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground cursor-pointer">
                      {photoBusy ? "Uploading…" : "+ Photo"}
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={photoBusy}
                        onChange={(e) => void addReviewPhotos(e.target.files)} />
                    </label>
                  )}
                </div>
                {photoError && <p className="mt-1 text-xs text-red-400">{photoError}</p>}
              </div>
              <button 
                onClick={() => {
                  reviewMutation.mutate({ bookingId: booking.id, rating, comment, photoIds: reviewPhotos.map((p) => p.id) }, {
                    onSuccess: () => alert("Review submitted!")
                  });
                }}
                disabled={reviewMutation.isPending || photoBusy || !comment.trim()}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50"
              >
                {reviewMutation.isPending ? "Submitting..." : "Submit Review"}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}