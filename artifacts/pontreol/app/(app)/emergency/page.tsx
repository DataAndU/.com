"use client";

import Link from "next/link";
import { Droplets, Plug, KeyRound, Car, Truck, Wrench, Siren } from "lucide-react";

// Urgent jobs: each tile opens search for that trade, showing only providers
// who are free right now. Real emergencies go to 112 first.
const NEEDS = [
  { label: "Plumber", hint: "Leak, burst pipe, blocked drain", q: "plumber", icon: Droplets },
  { label: "Electrician", hint: "Power cut, short circuit, sparking", q: "electrician", icon: Plug },
  { label: "Key maker", hint: "Locked out, broken lock", q: "key", icon: KeyRound },
  { label: "Mechanic", hint: "Vehicle broke down, puncture", q: "mechanic", icon: Wrench },
  { label: "Driver / cab", hint: "Need a ride right now", q: "driver", icon: Car },
  { label: "Tempo", hint: "Urgent shifting or pickup", q: "tempo", icon: Truck },
];

export default function EmergencyPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3">
          <Siren className="h-8 w-8 text-red-500" />
          <h1 className="text-3xl font-bold">Emergency help</h1>
        </div>
        <p className="mt-2 text-muted-foreground">Tap what you need. We show people nearby who are free right now.</p>
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
          For fire, medical emergencies or danger to life, call <a href="tel:112" className="font-bold underline">112</a> first.
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {NEEDS.map(({ label, hint, q, icon: Icon }) => (
            <Link key={q} href={`/discover?now=1&q=${encodeURIComponent(q)}`}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-5 text-center hover:border-red-500">
              <Icon className="h-8 w-8 text-red-400" />
              <span className="font-semibold">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
