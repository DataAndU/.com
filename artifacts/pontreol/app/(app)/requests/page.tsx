"use client";

import { InboxTabs } from "@/components/inbox-tabs";
import { useBookings, useUpdateBookingStatus, useQuoteBooking, useQuoteResponse, useCompleteBooking } from "@/lib/api/bookings";
import { useMe } from "@/lib/api/account";
import { format } from "date-fns";
import { BookingSteps } from "@/components/booking-steps";
import { SentCelebration } from "@/components/celebration";
import { Inbox, CheckCircle2, XCircle, Clock, Check } from "lucide-react";

export default function RequestsPage() {
  const { data: user } = useMe();
  const { data: bookingsData, isLoading } = useBookings({});
  const statusMutation = useUpdateBookingStatus();
  const quoteMutation = useQuoteBooking();
  const quoteResponseMutation = useQuoteResponse();
  const completeMutation = useCompleteBooking();

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  }

  const isProvider = user?.role === "provider";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SentCelebration />
      <InboxTabs />
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          
          {bookingsData?.items.map(booking => {
            const iAmProvider = user?.id === booking.providerId;

            return (
              <div key={booking.id} className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <div className="mb-3 space-y-2">
                  <h3 className="text-lg font-semibold">{(booking as { listingTitle?: string | null }).listingTitle || "Booking"}</h3>
                  <BookingSteps status={booking.status} />
                  <p className="text-sm text-muted-foreground">{iAmProvider ? "Request received" : "You asked"} {format(new Date(booking.createdAt), "d MMM, h:mm a")}</p>
                </div>

                {booking.quotedPrice !== null && (
                  <p className="mt-3 text-sm">Price offered: <span className="font-semibold text-primary">₹{booking.quotedPrice.toLocaleString("en-IN")}</span></p>
                )}
                <a href={`/requests/${booking.id}`} className="mt-2 inline-block text-sm text-primary">See details →</a>

                <div className="mt-4 flex gap-2 justify-end">
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

                  {booking.status === "completed" && !iAmProvider && (
                    <a href={`/discover/${booking.listingId}`} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-500">
                      ↻ Book again
                    </a>
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
              </div>
            );
          })}

          {(!bookingsData?.items || bookingsData.items.length === 0) && (
            <div className="py-20 text-center border border-dashed border-border rounded-xl bg-card/50">
              <Inbox className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">No bookings yet.</p>
              <a href="/home" className="mt-3 inline-block text-sm text-primary">Find help nearby →</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}