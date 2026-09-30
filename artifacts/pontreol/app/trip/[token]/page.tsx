import type { Metadata } from "next";
import { headers } from "next/headers";
import { BadgeCheck, Car, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Shared trip · Pontreol", robots: { index: false, follow: false } };

type Trip = {
  category?: string; service?: string | null; status: string; from: string | null; to: string | null; departureAt: string | null; vehicle: string | null;
  seats: number | null; driverFirstName: string | null; driverVerified: boolean; updatedAt: string | null; expiresAt: string | null;
};

const STATUS: Record<string, string> = {
  requested: "Requested — waiting for confirmation", confirmed: "Confirmed", completed: "Completed",
  cancelled: "Cancelled", declined: "Declined",
};

async function loadTrip(token: string): Promise<Trip | null> {
  // Server-side fetch through the same public origin the browser uses.
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  if (!host) return null;
  try {
    const response = await fetch(`${proto}://${host}/api/trips/shared/${encodeURIComponent(token)}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as Trip) : null;
  } catch {
    return null;
  }
}

export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const trip = await loadTrip(token);
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#2a2d33] bg-[#16181A] p-7 text-white shadow-2xl">
        <img src="/logo.svg" alt="Pontreol" className="mx-auto mb-5 h-9" />
        {!trip ? (
          <p className="text-center text-sm text-gray-400">This trip link has expired or was switched off.</p>
        ) : (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-wide text-gray-400">{trip.category && trip.category !== "travel" ? "Shared booking" : "Shared trip"}</p>
              <h1 className="mt-1 text-xl font-semibold">{trip.category && trip.category !== "travel" ? (trip.service || "Booking") : `${trip.from || "—"} → ${trip.to || "—"}`}</h1>
              <p className="mt-2 inline-block rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-primary">{STATUS[trip.status] || trip.status}</p>
            </div>
            <dl className="space-y-3 rounded-xl border border-[#2a2d33] p-4 text-sm">
              {trip.departureAt && <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-gray-400" /><dt className="text-gray-400">Departure</dt><dd className="ml-auto">{new Date(trip.departureAt).toLocaleString("en-IN")}</dd></div>}
              {trip.vehicle && <div className="flex items-center gap-2"><Car className="h-4 w-4 text-gray-400" /><dt className="text-gray-400">Vehicle</dt><dd className="ml-auto">{trip.vehicle}{trip.seats ? ` · ${trip.seats} seat${trip.seats === 1 ? "" : "s"}` : ""}</dd></div>}
              {trip.driverFirstName && <div className="flex items-center gap-2"><BadgeCheck className={`h-4 w-4 ${trip.driverVerified ? "text-sky-300" : "text-gray-500"}`} /><dt className="text-gray-400">{trip.category && trip.category !== "travel" ? "Provider" : "Driver"}</dt><dd className="ml-auto">{trip.driverFirstName}{trip.driverVerified ? " · ID verified" : ""}</dd></div>}
            </dl>
            {trip.updatedAt && <p className="text-center text-xs text-gray-500">Last updated {new Date(trip.updatedAt).toLocaleString("en-IN")}. Refresh for the latest status.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
