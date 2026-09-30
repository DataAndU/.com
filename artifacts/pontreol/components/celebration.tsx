"use client";

import { useEffect, useState } from "react";

/** Full-screen "🎉 Request sent" moment, shown once after ?sent=1. */
export function SentCelebration() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("sent") === "1") {
      setShow(true);
      url.searchParams.delete("sent");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setShow(false)} role="dialog" aria-modal="true" aria-label="Request sent">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="text-6xl" aria-hidden="true">🎉</div>
        <h2 className="mt-3 text-2xl font-bold">Request sent!</h2>
        <p className="mt-2 text-sm text-muted-foreground">The helper will reply soon. We&apos;ll notify you when they accept or send a price.</p>
        <button type="button" onClick={() => setShow(false)} className="mt-6 w-full rounded-lg bg-primary py-3 font-semibold text-primary-foreground">Great</button>
      </div>
    </div>
  );
}

/** Happy banner on a booking the customer made, once it is accepted or done. */
export function BookingMoment({ status, isBuyer }: { status: string; isBuyer: boolean }) {
  if (!isBuyer) return null;
  if (status === "confirmed") {
    return <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"><span className="text-xl mr-2" aria-hidden="true">🙌</span><b>Accepted!</b> Your helper has confirmed. You can message them or share the status with family below.</div>;
  }
  if (status === "completed") {
    return <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"><span className="text-xl mr-2" aria-hidden="true">⭐</span><b>All done!</b> How was it? A quick rating helps your neighbours choose.</div>;
  }
  return null;
}
