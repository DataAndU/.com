"use client";

import { useBookings, useUpdateBookingStatus, useQuoteBooking, useQuoteResponse, useCompleteBooking } from "@/lib/api/bookings";
import { useMe } from "@/lib/api/account";
import { format } from "date-fns";
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
      <div className="shrink-0 border-b border-border bg-card px-6 py-4">
        <h1 className="text-2xl font-bold">Requests & Bookings</h1>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          
          {bookingsData?.items.map(booking => {
            const iAmProvider = user?.id === booking.providerId;
            const otherParty = iAmProvider ? "Buyer" : "Provider";

            return (
              <div key={booking.id} className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="text-xs font-semibold uppercase text-primary tracking-wider">{booking.category}</span>
                    <h3 className="text-lg font-bold mt-1">Booking for Listing {booking.listingId.substring(0, 8)}...</h3>
                    <p className="text-sm text-muted-foreground mt-1">Requested {format(new Date(booking.createdAt), "PPp")}</p>
                  </div>
                  <div className="px-3 py-1 bg-secondary text-secondary-foreground text-xs font-bold uppercase rounded-full">
                    {booking.status}
                  </div>
                </div>

                <div className="bg-background/50 border border-border rounded-lg p-4 text-sm mt-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <span className="text-muted-foreground">Booking ID:</span>
                    <span className="font-mono text-right">{booking.id}</span>
                    <span className="text-muted-foreground">{otherParty} ID:</span>
                    <span className="font-mono text-right">{iAmProvider ? booking.buyerId : booking.providerId}</span>
                    
                    {booking.quotedPrice !== null && (
                      <>
                        <span className="text-muted-foreground">Quoted Price:</span>
                        <span className="font-bold text-right text-primary">₹{booking.quotedPrice}</span>
                      </>
                    )}
                  </div>
                </div>

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
              <p className="text-muted-foreground">No requests or bookings found.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}