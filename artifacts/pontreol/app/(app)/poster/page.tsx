"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { useReferral } from "@/lib/api/account";

/** Printable neighbourhood launch poster. The QR carries the user's own
 *  invite link, so sign-ups from the poster count toward their referrals. */
export default function PosterPage() {
  const { data: referral } = useReferral();
  const [area, setArea] = useState("");
  const [qr, setQr] = useState("");
  const link = referral ? `${window.location.origin}${referral.path}` : "";

  useEffect(() => {
    if (!link) return;
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } })
      .then(setQr).catch(() => setQr(""));
  }, [link]);

  return (
    <div className="h-full overflow-y-auto">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #pontreol-poster, #pontreol-poster * { visibility: visible !important; }
        #pontreol-poster { position: fixed; inset: 0; margin: 0; border: 0; border-radius: 0; box-shadow: none; }
        @page { size: A4; margin: 12mm; }
      }`}</style>
      <div className="mx-auto max-w-3xl space-y-4 p-6 print:hidden">
        <h1 className="text-2xl font-bold">Launch poster</h1>
        <p className="text-sm text-muted-foreground">Print and put it up in local shops, gates and notice boards. The QR code opens Pontreol with your invite link.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={area} onChange={(e) => setArea(e.target.value.slice(0, 40))} placeholder="Your area, e.g. Koramangala"
            className="flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm" aria-label="Area name" data-testid="input-poster-area" />
          <button type="button" onClick={() => window.print()} disabled={!qr}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" data-testid="button-print-poster">
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="px-6 pb-10">
        <div id="pontreol-poster" className="mx-auto flex aspect-[1/1.414] max-w-md flex-col items-center justify-between rounded-2xl bg-white p-8 text-center text-slate-900 shadow-2xl">
          <div>
            <img src="/logo.svg" alt="Pontreol" className="mx-auto h-14" />
            <p className="mt-2 text-sm font-bold uppercase tracking-[0.3em] text-slate-500">Pontreol</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-teal-700">{area.trim() ? `Now live in ${area.trim()}` : "Now live near you"}</p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight">Everything you need,<br />right next door.</h2>
            <p className="mt-3 text-sm text-slate-600">Plumbers · Tempos · Tools · Halls · Rides</p>
            <p className="mt-1 text-sm font-medium text-slate-700">Hire it. Book it. Ride it. Nearby.</p>
          </div>
          <div>
            {qr ? <div className="mx-auto h-44 w-44" dangerouslySetInnerHTML={{ __html: qr }} /> : <div className="mx-auto h-44 w-44 animate-pulse rounded bg-slate-200" />}
            <p className="mt-2 text-sm font-semibold">Scan to join free</p>
            <p className="text-xs text-slate-500">Have a skill, vehicle or space? Earn from it on Pontreol.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
