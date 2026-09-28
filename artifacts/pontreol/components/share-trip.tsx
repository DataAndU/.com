"use client";

import { useState } from "react";
import { MapPinned } from "lucide-react";
import { fetchApi } from "@/lib/api/client";

/** Traveller-only: create / stop a read-only trip status link for family. */
export function ShareTrip({ bookingId }: { bookingId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setPending(true); setError("");
    try {
      const result = await fetchApi<{ path: string; expiresAt: string }>(`/bookings/${bookingId}/share`, { method: "POST", body: "{}" });
      setLink(`${window.location.origin}${result.path}`);
      setExpiresAt(result.expiresAt);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the link"); }
    finally { setPending(false); }
  }

  async function stop() {
    setPending(true); setError("");
    try { await fetchApi(`/bookings/${bookingId}/share`, { method: "DELETE" }); setLink(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not switch the link off"); }
    finally { setPending(false); }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5" data-testid="panel-share-trip">
      <div className="flex items-center gap-2"><MapPinned className="h-5 w-5 text-primary" /><h3 className="font-semibold">Share my trip</h3></div>
      <p className="mt-1 text-xs text-muted-foreground">Send family a link showing your route, departure and trip status. No phone numbers or emails are shown.</p>
      {!link ? (
        <button type="button" onClick={() => void create()} disabled={pending} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" data-testid="button-share-trip">
          {pending ? "Creating…" : "Create share link"}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <input readOnly value={link} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" onFocus={(e) => e.currentTarget.select()} aria-label="Trip link" />
          <div className="flex flex-wrap gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(`Track my Pontreol trip: ${link}`)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white">Send on WhatsApp</a>
            <button type="button" onClick={() => void stop()} disabled={pending} className="rounded-lg border border-border px-3 py-2 text-sm" data-testid="button-stop-share">Stop sharing</button>
          </div>
          {expiresAt && <p className="text-xs text-muted-foreground">Link works until {new Date(expiresAt).toLocaleString()}.</p>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-300" role="alert">{error}</p>}
    </section>
  );
}
