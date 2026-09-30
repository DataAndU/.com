"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building } from "lucide-react";

function societySlug(name: string) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export default function SocietyFinderPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const slug = societySlug(name);
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center gap-3"><Building className="h-8 w-8 text-primary" /><h1 className="text-3xl font-bold">My society</h1></div>
        <p className="mt-2 text-muted-foreground">See the maids, cooks, drivers, plumbers and other helpers your neighbours already trust, and recommend the ones you use.</p>
        <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (slug.length >= 3) router.push(`/society/${slug}?name=${encodeURIComponent(name.trim())}`); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Society / apartment name, area (e.g. Prestige Lakeside, Whitefield)"
            className="flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm" />
          <button type="submit" disabled={slug.length < 3} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Open</button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Tip: write the name the same way your neighbours would, including the area, so everyone lands on the same page.</p>
      </div>
    </div>
  );
}
