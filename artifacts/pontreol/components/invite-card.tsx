"use client";

import { useState } from "react";
import { Gift } from "lucide-react";
import { useReferral } from "@/lib/api/account";

/** Refer-a-provider: personal link, WhatsApp share and progress. */
export function InviteCard() {
  const { data } = useReferral();
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  const link = `${window.location.origin}${data.path}`;
  const message = `Join me on Pontreol — list your services, space, delivery or travel and get local customers. Sign up here: ${link}`;
  return (
    <section className="rounded-xl border border-border bg-card p-6" data-testid="card-invite">
      <div className="flex items-center gap-3">
        <Gift className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-semibold">Refer a provider, get a free month</h2>
          <p className="text-xs text-muted-foreground">When someone joins with your link and becomes a provider, you earn one free month.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input readOnly value={link} aria-label="Your invite link" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-foreground/5"
          onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }}>
          {copied ? "Copied" : "Copy"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
          className="rounded-lg bg-[#25D366] px-3 py-2 text-center text-sm font-semibold text-white hover:opacity-90" data-testid="button-invite-whatsapp">
          Share on WhatsApp
        </a>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div><dt className="text-xs text-muted-foreground">Joined</dt><dd className="text-lg font-bold">{data.invited}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Became providers</dt><dd className="text-lg font-bold">{data.providers}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Free months earned</dt><dd className="text-lg font-bold text-primary">{data.creditMonths}</dd></div>
      </dl>
    </section>
  );
}
