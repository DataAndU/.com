import type { MapPin } from "@/lib/api/listings";

// Availability wording built only from real data returned by the API.
const time = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

function dayLabel(d: Date) {
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export type AvailabilityText = { tone: "now" | "later" | "unknown"; main: string; sub?: string };

export function availabilityText(pin: MapPin): AvailabilityText {
  if (pin.availableNow) {
    return { tone: "now", main: "Available now", sub: pin.availableUntil ? `Until ${time(new Date(pin.availableUntil))}` : undefined };
  }
  if (pin.nextSlotStart && pin.nextSlotEnd) {
    const start = new Date(pin.nextSlotStart), end = new Date(pin.nextSlotEnd);
    if (start <= new Date()) return { tone: "now", main: "Available now", sub: `Until ${time(end)}` };
    return { tone: "later", main: `${dayLabel(start)} · ${time(start)}–${time(end)}` };
  }
  if (pin.departureAt) {
    const d = new Date(pin.departureAt);
    if (!Number.isNaN(d.getTime())) return { tone: "later", main: `Departs ${dayLabel(d)} · ${time(d)}` };
  }
  return { tone: "unknown", main: "Ask for times" };
}

export const priceText = (pin: Pick<MapPin, "price">) => `₹${Math.round(pin.price).toLocaleString("en-IN")}`;

export const distanceText = (km?: number | null) =>
  km == null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

export const CATEGORY_LABEL: Record<string, string> = { services: "Services", spaces: "Spaces", delivery: "Delivery", travel: "Travel" };
