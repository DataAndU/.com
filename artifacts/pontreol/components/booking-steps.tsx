import { Check, X } from "lucide-react";

const STEPS = [
  { key: "requested", label: "Requested" },
  { key: "quoted", label: "Price sent" },
  { key: "confirmed", label: "Accepted" },
  { key: "completed", label: "Done" },
];

/** Booking progress as coloured dots instead of status words. */
export function BookingSteps({ status }: { status: string }) {
  if (status === "declined" || status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-400">
        <X className="h-3.5 w-3.5" /> {status === "declined" ? "Declined" : "Cancelled"}
      </span>
    );
  }
  const current = Math.max(0, STEPS.findIndex((s) => s.key === status));
  return (
    <ol className="flex items-center gap-1" aria-label={`Status: ${STEPS[current]?.label ?? status}`}>
      {STEPS.map((step, i) => {
        const done = i < current || status === "completed";
        const active = i === current && status !== "completed";
        return (
          <li key={step.key} className="flex items-center gap-1">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground ring-2 ring-primary/40" : "bg-muted text-muted-foreground"}`}>
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={`text-[11px] ${active ? "font-semibold text-foreground" : "text-muted-foreground"} ${active ? "" : "hidden sm:inline"}`}>{step.label}</span>
            {i < STEPS.length - 1 && <span className={`mx-0.5 h-0.5 w-3 sm:w-5 ${i < current || status === "completed" ? "bg-emerald-500" : "bg-muted"}`} />}
          </li>
        );
      })}
    </ol>
  );
}
