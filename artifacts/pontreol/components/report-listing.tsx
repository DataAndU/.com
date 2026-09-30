"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { fetchApi } from "@/lib/api/client";

export function ReportListing({ listingId }: { listingId: string }) {
  const [state, setState] = useState<"idle" | "sent">("idle");
  const [error, setError] = useState("");
  const report = async () => {
    const reason = window.prompt("What is wrong with this listing? (e.g. fake, asks for advance payment, not allowed)");
    if (!reason || reason.trim().length < 5) return;
    setError("");
    try {
      await fetchApi(`/listings/${listingId}/report`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      setState("sent");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send the report"); }
  };
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <button type="button" onClick={() => void report()} disabled={state === "sent"}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-70" data-testid="button-report-listing">
        <Flag className="h-3.5 w-3.5" /> {state === "sent" ? "Reported. Thank you" : "Report listing"}
      </button>
      {error && <span className="text-red-500" role="alert">{error}</span>}
    </span>
  );
}
