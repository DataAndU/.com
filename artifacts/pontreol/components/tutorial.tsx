"use client";
import { Overlay } from "@/components/overlay";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

/** Tiny CSS "map" with price pills: no images, no dependencies. */
function MiniMap({ selected = false }: { selected?: boolean }) {
  const pill = (label: string, style: React.CSSProperties, green = false, dark = false) => (
    <span className={`absolute rounded-full px-2 py-0.5 text-[11px] font-semibold shadow ${dark ? "bg-foreground text-background" : green ? "bg-emerald-600 text-white" : "bg-white text-slate-900 border border-slate-300"}`} style={style}>
      {green && !dark ? "● " : ""}{label}
    </span>
  );
  return (
    <div className="relative h-36 w-full overflow-hidden rounded-xl border border-border"
      style={{ background: "repeating-linear-gradient(45deg, hsl(var(--muted)) 0 12px, hsl(var(--background)) 12px 24px)" }} aria-hidden="true">
      {pill("₹500", { left: "18%", top: "22%" }, true, selected)}
      {pill("₹300", { left: "58%", top: "18%" })}
      {pill("₹800", { left: "38%", top: "58%" }, true)}
      <span className="absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600" style={{ left: "70%", top: "62%" }} />
    </div>
  );
}

const STEPS = 3;

export function Tutorial({ onDone }: { onDone: (next: "explore" | "post" | "skip") => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDone("skip"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return (
    <Overlay>
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="How Pontreol works">
      <div className="w-full max-w-sm rounded-2xl bg-card text-foreground shadow-2xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS}`}>
            {Array.from({ length: STEPS }, (_, i) => (
              <span key={i} className={`h-1.5 rounded-full ${i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"}`} />
            ))}
          </div>
          {step < STEPS - 1 && (
            <button type="button" onClick={() => onDone("skip")} className="px-2 py-1 text-sm text-muted-foreground" data-testid="tutorial-skip">Skip</button>
          )}
        </div>

        {step === 0 && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-border px-3 h-10 text-sm text-muted-foreground" aria-hidden="true">
              <Search className="h-4 w-4" /> What do you need?
            </div>
            <MiniMap />
            <h2 className="text-xl font-semibold">Find what you need</h2>
            <p className="text-sm text-muted-foreground">Services, Spaces, Delivery and Travel available around you.</p>
          </div>
        )}

        {step === 1 && (
          <div className="mt-4 space-y-3">
            <MiniMap selected />
            <div className="rounded-xl border border-border p-3 text-sm" aria-hidden="true">
              <p className="font-semibold text-emerald-600 dark:text-emerald-400">🟢 Available now</p>
              <p>Today · 2–5 PM</p>
              <p className="text-muted-foreground">1.2 km away · ₹500</p>
            </div>
            <h2 className="text-xl font-semibold">Find it when you need it</h2>
            <p className="text-sm text-muted-foreground">Use the map and Now / Today to see what’s free.</p>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 space-y-3">
            <h2 className="text-xl font-semibold">Need something, or have something?</h2>
            <p className="text-sm text-muted-foreground">One account, both ways.</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl border border-border p-3"><p className="text-lg" aria-hidden="true">🔍</p><p className="font-semibold">Find</p><p className="text-xs text-muted-foreground">Search what’s available</p></div>
              <div className="rounded-xl border border-border p-3"><p className="text-lg" aria-hidden="true">➕</p><p className="font-semibold">Provide</p><p className="text-xs text-muted-foreground">Post your availability, get requests</p></div>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {step < STEPS - 1 ? (
            <button type="button" onClick={() => setStep(step + 1)} className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground" data-testid="tutorial-next">Next</button>
          ) : (
            <>
              <button type="button" onClick={() => onDone("explore")} className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground" data-testid="tutorial-explore">Explore Pontreol</button>
              <button type="button" onClick={() => onDone("post")} className="w-full rounded-xl border border-border py-3 font-semibold" data-testid="tutorial-post">Post availability</button>
            </>
          )}
        </div>
      </div>
    </div>
    </Overlay>
  );
}
