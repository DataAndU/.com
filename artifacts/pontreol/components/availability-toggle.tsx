"use client";

import { useMe, useSetAvailability } from "@/lib/api/account";

function remaining(until?: string | null) {
  if (!until) return "";
  const minutes = Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m left`;
}

/** Provider switch: shows their pins in green on the map for a few hours. */
export function AvailabilityToggle() {
  const { data: user } = useMe();
  const setAvailability = useSetAvailability();
  if (user?.role !== "provider") return null;
  const on = !!user.availableNow;
  return (
    <div className="mb-4 rounded-xl border border-border bg-background/50 p-3" data-testid="panel-available-now">
      <button type="button" role="switch" aria-checked={on} disabled={setAvailability.isPending}
        onClick={() => setAvailability.mutate({ available: !on, hours: 4 })}
        className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-60" data-testid="toggle-available-now">
        <span>
          <span className="block text-sm font-semibold">{on ? "You're available now" : "Available now?"}</span>
          <span className="block text-xs text-muted-foreground">
            {on ? `Green pin on the map · ${remaining(user.availableUntil)}` : "Show buyers you can take work for the next 4 hours"}
          </span>
        </span>
        <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-green-500" : "bg-secondary"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        </span>
      </button>
      {setAvailability.error && <p className="mt-2 text-xs text-red-300">{setAvailability.error.message}</p>}
    </div>
  );
}
