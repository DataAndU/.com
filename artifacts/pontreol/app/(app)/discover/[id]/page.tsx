"use client";

import { ListingPhoto } from "@/components/listing-photo";
import { useListing } from "@/lib/api/listings";
import { useCreateServiceBooking, useCreateSpaceBooking, useCreateEquipmentBooking, useCreateDeliveryBooking, useCreateTravelBooking } from "@/lib/api/bookings";
import { useCreateConversation } from "@/lib/api/messages";
import { useMe } from "@/lib/api/account";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { MapPin, MessageSquare, Star, ArrowLeft } from "lucide-react";
import { ShareListing } from "@/components/share-listing";
import { ProviderBadges } from "@/components/provider-badges";

export default function ListingDetailPage() {
  // Next 16 passes `params` to pages as a Promise; read route params via the hook.
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: user } = useMe();
  const { data: listing, isLoading, isError, error, refetch } = useListing(params.id);
  const createConv = useCreateConversation();

  const [bookingNote, setBookingNote] = useState("");
  const [msgText, setMsgText] = useState("");
  const [bookingError, setBookingError] = useState("");
  
  // Equipment
  const equipmentBooking = useCreateEquipmentBooking();
  const [equipStart, setEquipStart] = useState("");
  const [equipEnd, setEquipEnd] = useState("");
  const [operatorReq, setOperatorReq] = useState(false);

  // Spaces
  const spaceBooking = useCreateSpaceBooking();
  const [spaceMode, setSpaceMode] = useState<"hourly"|"daily">("daily");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");

  // Delivery
  const deliveryBooking = useCreateDeliveryBooking();
  const [pickupAt, setPickupAt] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLng, setPickupLng] = useState("");
  const [dropoffLat, setDropoffLat] = useState("");
  const [dropoffLng, setDropoffLng] = useState("");

  // Travel
  const travelBooking = useCreateTravelBooking();
  const [seats, setSeats] = useState("1");

  // Service
  const serviceBooking = useCreateServiceBooking();
  const [serviceReqAt, setServiceReqAt] = useState("");

  if (isLoading) return <div className="p-8 flex justify-center"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;
  if (isError && !listing) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="font-medium text-destructive">Unable to load this listing.</p>
        <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Please try again."}</p>
        <div className="flex justify-center gap-3">
          <button onClick={() => router.back()} className="px-4 py-2 rounded-lg border border-border hover:bg-white/5">Go back</button>
          <button onClick={() => refetch()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">Try again</button>
        </div>
      </div>
    );
  }
  if (!listing) return <div className="p-8 text-center">Listing not found</div>;

  const handleMessage = () => {
    if (!msgText.trim()) return;
    createConv.mutate({ listingId: listing.id, providerId: listing.providerId, initialMessage: msgText.trim() }, {
      onSuccess: (res) => {
        router.push(`/messages?conversationId=${res.conversation.id}`);
      }
    });
  };

  const handleBookService = () => {
    setBookingError("");
    if (!serviceReqAt || isNaN(new Date(serviceReqAt).getTime())) return setBookingError("Invalid requested date");
    
    serviceBooking.mutate({ listingId: listing.id, requestedAt: new Date(serviceReqAt).toISOString(), note: bookingNote }, {
      onSuccess: () => router.push("/requests"),
      onError: (err) => setBookingError(err.message)
    });
  };

  const handleBookEquipment = () => {
    setBookingError("");
    if (!equipStart || isNaN(new Date(equipStart).getTime())) return setBookingError("Invalid start date");
    if (!equipEnd || isNaN(new Date(equipEnd).getTime())) return setBookingError("Invalid end date");
    if (new Date(equipEnd) <= new Date(equipStart)) return setBookingError("End date must be after start date");

    equipmentBooking.mutate({ listingId: listing.id, startsAt: new Date(equipStart).toISOString(), endsAt: new Date(equipEnd).toISOString(), operatorRequested: operatorReq, note: bookingNote }, {
      onSuccess: () => router.push("/requests"),
      onError: (err) => setBookingError(err.message)
    });
  };

  const handleBookSpace = () => {
    setBookingError("");
    if (!checkIn || isNaN(new Date(checkIn).getTime())) return setBookingError("Invalid check-in date");
    if (!checkOut || isNaN(new Date(checkOut).getTime())) return setBookingError("Invalid check-out date");
    if (new Date(checkOut) <= new Date(checkIn)) return setBookingError("Check out must be after check in");

    spaceBooking.mutate({ listingId: listing.id, mode: spaceMode, checkIn: new Date(checkIn).toISOString(), checkOut: new Date(checkOut).toISOString(), note: bookingNote }, {
      onSuccess: () => router.push("/requests"),
      onError: (err) => setBookingError(err.message)
    });
  };

  const handleBookDelivery = async () => {
    setBookingError("");
    if (!pickupAt || isNaN(new Date(pickupAt).getTime())) return setBookingError("Invalid pickup date");
    if (!itemDesc.trim()) return setBookingError("Item description is required");
    if (!pickupLat.trim() || !dropoffLat.trim()) return setBookingError("Pickup and Dropoff addresses are required");

    // We assume pickupLat and dropoffLat are used as the address labels for input to avoid creating too many states. Let's rename visually in UI.
    try {
      // Pickup and dropoff are independent lookups; resolve them in parallel.
      const [pRes, dRes] = await Promise.all([
        fetch(`/api/geocode?q=${encodeURIComponent(pickupLat)}`).then(r => r.json()),
        fetch(`/api/geocode?q=${encodeURIComponent(dropoffLat)}`).then(r => r.json()),
      ]);
      
      if (!pRes?.results?.[0]) return setBookingError("Pickup address not found");
      if (!dRes?.results?.[0]) return setBookingError("Dropoff address not found");

      deliveryBooking.mutate({ 
        listingId: listing.id, 
        pickupAt: new Date(pickupAt).toISOString(), 
        itemDescription: itemDesc, 
        pickup: { label: pickupLat, latitude: pRes.results[0].latitude, longitude: pRes.results[0].longitude },
        dropoff: { label: dropoffLat, latitude: dRes.results[0].latitude, longitude: dRes.results[0].longitude },
        note: bookingNote 
      }, {
        onSuccess: () => router.push("/requests"),
        onError: (err) => setBookingError(err.message)
      });
    } catch (err: any) {
      setBookingError(err.message);
    }
  };

  const handleBookTravel = () => {
    setBookingError("");
    if (!seats || isNaN(Number(seats)) || Number(seats) < 1) return setBookingError("Invalid seat count");

    travelBooking.mutate({ listingId: listing.id, seats: Number(seats), note: bookingNote }, {
      onSuccess: () => router.push("/requests"),
      onError: (err) => setBookingError(err.message)
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-white/5 rounded-full"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold truncate flex-1">{listing.title}</h1>
        <ShareListing listing={listing} />
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          
          <div className="md:col-span-2 space-y-6">
            <div className="aspect-video bg-card border border-border rounded-xl overflow-hidden relative">
              {listing.photos && listing.photos.length > 0 ? (
                <ListingPhoto photo={listing.photos[0]} className="w-full h-full object-cover" eager />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-input">No Photos</div>
              )}
            </div>
            
            <div>
              <div className="flex justify-between items-start mb-2">
                <h2 className="text-2xl font-bold">{listing.title}</h2>
                <div className="text-right">
                  <div className="text-2xl font-bold text-primary">₹{listing.price}</div>
                  <div className="text-xs text-muted-foreground uppercase">{listing.pricingMode}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground mb-6">
                <MapPin className="w-4 h-4" />
                <span>{listing.locationLabel}</span>
              </div>
              <p className="text-foreground leading-relaxed whitespace-pre-wrap">{listing.description}</p>
            </div>
            
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4">About Provider</h3>
              <div className="flex items-center gap-4 cursor-pointer hover:bg-white/5 p-2 rounded-lg transition-colors" onClick={() => router.push(`/providers/${listing.providerId}`)}>
                <img src={listing.provider?.avatarUrl || `https://ui-avatars.com/api/?name=${listing.provider?.displayName}`} alt="" className="w-12 h-12 rounded-full" />
                <div>
                  <div className="font-semibold">{listing.provider?.displayName || "Unknown Provider"}</div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Star className="w-4 h-4 fill-primary text-primary" />
                    <span>{listing.provider?.rating?.toFixed(1) || "New"} ({listing.provider?.reviewCount || 0} reviews)</span>
                    {listing.provider?.availableNow && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-400">● Available now</span>}
                  </div>
                  <div className="mt-1.5">
                    <ProviderBadges badges={listing.provider?.badges} />
                  </div>
                </div>
              </div>
              {user?.role === "buyer" && user.id !== listing.providerId && (
                <div className="mt-4 pt-4 border-t border-border">
                  <h4 className="text-sm font-medium mb-2">Send Message</h4>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={msgText}
                      onChange={e=>setMsgText(e.target.value)}
                      placeholder="Hi, is this available?"
                      className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm"
                    />
                    <button 
                      onClick={handleMessage}
                      disabled={createConv.isPending || !msgText.trim()}
                      className="bg-secondary text-secondary-foreground px-4 rounded-lg font-medium hover:bg-secondary/90 disabled:opacity-50"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div>
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm sticky top-6">
              <h3 className="text-lg font-bold mb-4">Request Booking</h3>
              
              {user?.role !== "buyer" ? (
                <div className="text-center p-4 bg-secondary/50 rounded-lg text-sm">
                  You must be registered as a Buyer to request bookings.
                </div>
              ) : user.id === listing.providerId ? (
                <div className="text-center p-4 bg-secondary/50 rounded-lg text-sm">
                  You cannot book your own listing.
                </div>
              ) : (
                <div className="space-y-4">
                  {bookingError && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg border border-destructive/20">{bookingError}</div>}
                  {listing.category === "services" && (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1">Requested Date & Time</label>
                        <input type="datetime-local" value={serviceReqAt} onChange={e=>setServiceReqAt(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Note to Provider</label>
                        <textarea value={bookingNote} onChange={e=>setBookingNote(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm h-20" placeholder="Any specific requirements..." />
                      </div>
                      <button 
                        onClick={handleBookService}
                        disabled={serviceBooking.isPending || !serviceReqAt}
                        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {serviceBooking.isPending ? "Requesting..." : "Request Service"}
                      </button>
                    </>
                  )}
                  
                  {listing.category === "equipment" && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium mb-1">Start Date</label>
                          <input type="date" value={equipStart} onChange={e=>setEquipStart(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">End Date</label>
                          <input type="date" value={equipEnd} onChange={e=>setEquipEnd(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={operatorReq} onChange={e=>setOperatorReq(e.target.checked)} className="rounded border-border" />
                        Request Operator
                      </label>
                      <div>
                        <label className="block text-xs font-medium mb-1">Note to Provider</label>
                        <textarea value={bookingNote} onChange={e=>setBookingNote(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm h-20" placeholder="Any specific requirements..." />
                      </div>
                      <button 
                        onClick={handleBookEquipment}
                        disabled={equipmentBooking.isPending || !equipStart || !equipEnd}
                        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {equipmentBooking.isPending ? "Requesting..." : "Request Equipment"}
                      </button>
                    </>
                  )}

                  {listing.category === "spaces" && (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1">Booking Mode</label>
                        <select value={spaceMode} onChange={(e: any)=>setSpaceMode(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm">
                          <option value="daily">Daily</option>
                          <option value="hourly">Hourly</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium mb-1">Check In</label>
                          <input type={spaceMode === "hourly" ? "datetime-local" : "date"} value={checkIn} onChange={e=>setCheckIn(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Check Out</label>
                          <input type={spaceMode === "hourly" ? "datetime-local" : "date"} value={checkOut} onChange={e=>setCheckOut(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Note to Provider</label>
                        <textarea value={bookingNote} onChange={e=>setBookingNote(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm h-20" placeholder="Any specific requirements..." />
                      </div>
                      <button 
                        onClick={handleBookSpace}
                        disabled={spaceBooking.isPending || !checkIn || !checkOut}
                        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {spaceBooking.isPending ? "Requesting..." : "Book Space"}
                      </button>
                    </>
                  )}

                  {listing.category === "delivery" && (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1">Pickup Date & Time</label>
                        <input type="datetime-local" value={pickupAt} onChange={e=>setPickupAt(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Item Description</label>
                        <input type="text" value={itemDesc} onChange={e=>setItemDesc(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-xs font-medium mb-1">Pickup Address</label>
                          <input type="text" placeholder="Full pickup address..." value={pickupLat} onChange={e=>setPickupLat(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm mb-1" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Dropoff Address</label>
                          <input type="text" placeholder="Full dropoff address..." value={dropoffLat} onChange={e=>setDropoffLat(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm mb-1" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Note to Provider</label>
                        <textarea value={bookingNote} onChange={e=>setBookingNote(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm h-20" placeholder="Any specific requirements..." />
                      </div>
                      <button 
                        onClick={handleBookDelivery}
                        disabled={deliveryBooking.isPending || !pickupAt || !itemDesc || !pickupLat || !dropoffLat}
                        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {deliveryBooking.isPending ? "Requesting..." : "Request Delivery"}
                      </button>
                    </>
                  )}

                  {listing.category === "travel" && (
                    <>
                      <div>
                        <label className="block text-xs font-medium mb-1">Seats Required</label>
                        <input type="number" min="1" value={seats} onChange={e=>setSeats(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Note to Provider</label>
                        <textarea value={bookingNote} onChange={e=>setBookingNote(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm h-20" placeholder="Any specific requirements..." />
                      </div>
                      <button 
                        onClick={handleBookTravel}
                        disabled={travelBooking.isPending || !seats}
                        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {travelBooking.isPending ? "Requesting..." : "Reserve Seats"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}