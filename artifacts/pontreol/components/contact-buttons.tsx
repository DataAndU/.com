"use client";

import { useState } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { fetchApi, type ProviderSummary } from "@/lib/api/client";

/** "Call" / "WhatsApp" for buyers. Revealing counts toward the free contact
 *  limit on the server, so numbers load only when the buyer asks. */
export function ContactButtons({ listingId, title }: { listingId: string; title: string }) {
  const [contact, setContact] = useState<ProviderSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const reveal = async () => {
    setPending(true); setError("");
    try {
      const result = await fetchApi<{ provider: ProviderSummary }>(`/listings/${listingId}/contact`, { method: "POST", body: "{}" });
      setContact(result.provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load contact details");
    } finally { setPending(false); }
  };

  if (!contact) {
    return (
      <div>
        <button type="button" onClick={() => void reveal()} disabled={pending}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50" data-testid="button-show-contact">
          <Phone className="h-4 w-4" /> {pending ? "Loading…" : "Call or WhatsApp"}
        </button>
        {error && <p className="mt-2 text-xs text-red-400" role="alert">{error}</p>}
      </div>
    );
  }

  const phone = contact.contactPhone?.replace(/[^\d+]/g, "") || "";
  const waNumber = phone.replace(/^\+/, "").replace(/^0/, "91");
  const hello = encodeURIComponent(`Hi, I found your listing "${title}" on Pontreol. Is it available?`);
  if (!phone) {
    return <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">This provider prefers messages. Use &quot;Send Message&quot; below.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <a href={`tel:${phone}`} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-500">
        <Phone className="h-4 w-4" /> Call
      </a>
      <a href={`https://wa.me/${waNumber}?text=${hello}`} target="_blank" rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-3 font-semibold text-white hover:opacity-90">
        <MessageCircle className="h-4 w-4" /> WhatsApp
      </a>
    </div>
  );
}
