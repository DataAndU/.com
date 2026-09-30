"use client";

import { useListingAvailability, useUpdateAvailability } from "@/lib/api/listings";
import { format, addDays } from "date-fns";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

export default function AvailabilityPage() {
  // Next 16 passes `params` to pages as a Promise; read route params via the hook.
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [from] = useState(() => format(new Date(), "yyyy-MM-dd'T'00:00:00'Z'"));
  const [to] = useState(() => format(addDays(new Date(), 30), "yyyy-MM-dd'T'23:59:59'Z'"));
  
  const { data, isLoading } = useListingAvailability(params.id, from, to);
  const updateMutation = useUpdateAvailability();

  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [slots, setSlots] = useState<{ startsAt: string; endsAt: string }[]>([]);

  // Simple initialization logic for demo purposes
  // In a real app, we would parse `data.slots` into the local state for editing.
  
  const handleAddSlot = () => {
    setSlots([...slots, { startsAt: "", endsAt: "" }]);
  };

  const handleSave = () => {
    updateMutation.mutate({
      id: params.id,
      data: {
        timezone,
        slots: slots.filter(s => s.startsAt && s.endsAt)
      }
    }, {
      onSuccess: () => alert("Availability updated")
    });
  };

  const [justPosted, setJustPosted] = useState(false);
  useEffect(() => { setJustPosted(new URLSearchParams(window.location.search).get("new") === "1"); }, []);
  if (isLoading) return <div className="p-8 flex justify-center"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-foreground/5 rounded-full"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold truncate">Available times</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {justPosted && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
              <b>Posted!</b> Now add the times you&apos;re available. Customers searching &quot;Now&quot; or &quot;Today&quot; only see listings with times.
              Providers can also switch on <b>Available now</b> in Profile.
            </div>
          )}
          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">When are you available?</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Timezone</label>
              <input type="text" value={timezone} onChange={e=>setTimezone(e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm" />
            </div>

            <div className="space-y-3 mb-6">
              {slots.map((slot, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="datetime-local" value={slot.startsAt} onChange={e => { const n = [...slots]; n[i].startsAt = e.target.value; setSlots(n); }} className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                  <span className="text-muted-foreground">to</span>
                  <input type="datetime-local" value={slot.endsAt} onChange={e => { const n = [...slots]; n[i].endsAt = e.target.value; setSlots(n); }} className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm" />
                  <button onClick={() => setSlots(slots.filter((_, idx) => idx !== i))} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-border">
              <button onClick={handleAddSlot} className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                <Plus className="w-4 h-4" /> Add Slot
              </button>

              <button 
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {updateMutation.isPending ? "Saving..." : "Save Availability"}
              </button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold text-sm mb-3 text-muted-foreground">Server Availability Preview (Next 30 Days)</h3>
            <div className="divide-y divide-border text-sm">
              {data?.slots.map((s, i) => (
                <div key={i} className="py-2 flex justify-between items-center">
                  <div>
                    <span className="font-medium">{format(new Date(s.startsAt), "MMM d, h:mm a")}</span>
                    <span className="mx-2 text-muted-foreground">→</span>
                    <span className="font-medium">{format(new Date(s.endsAt), "MMM d, h:mm a")}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${s.available ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
                    {s.available ? "Available" : "Booked"}
                  </span>
                </div>
              ))}
              {(!data?.slots || data.slots.length === 0) && (
                <div className="py-4 text-center text-muted-foreground text-xs">No explicit slots returned.</div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}