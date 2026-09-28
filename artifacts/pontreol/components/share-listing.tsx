"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import type { Listing } from "@/lib/api/client";

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3M12 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8M20.5 3.5A11.8 11.8 0 0 0 1.9 17.9L.2 24l6.3-1.6A11.8 11.8 0 0 0 20.5 3.5"/>
    </svg>
  );
}

/** Share a listing on WhatsApp (or the phone's share sheet). Only public details are shared. */
export function ShareListing({ listing }: { listing: Pick<Listing, "id" | "title" | "price" | "pricingMode" | "locationLabel"> }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/discover/${listing.id}` : `/discover/${listing.id}`;
  const price = `₹${listing.price}${listing.pricingMode === "negotiable" ? " (negotiable)" : ""}`;
  const text = `${listing.title} — ${price}, ${listing.locationLabel}. Found on Pontreol: ${url}`;

  async function nativeShare() {
    if (navigator.share) {
      try { await navigator.share({ title: listing.title, text, url }); } catch { /* cancelled */ }
      return;
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }

  return (
    <div className="flex items-center gap-2">
      <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        data-testid="button-share-whatsapp" aria-label="Share on WhatsApp">
        <WhatsAppIcon /> WhatsApp
      </a>
      <button type="button" onClick={() => void nativeShare()} className="rounded-full p-2 hover:bg-white/5" aria-label="Share" data-testid="button-share">
        {copied ? <span className="text-xs text-primary">Copied</span> : <Share2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
