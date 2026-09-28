"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { fetchApi } from "@/lib/api/client";

type Banner = { id: string; message: string; linkPath: string | null };

/** Admin-managed seasonal/festival announcement at the top of the home map. */
export function HomeBanner() {
  const { data } = useQuery<{ banner: Banner | null }>({
    queryKey: ["banner"], queryFn: () => fetchApi("/banner"), staleTime: 10 * 60_000,
  });
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  const banner = data?.banner;
  if (!banner || hiddenId === banner.id) return null;
  const body = (
    <span className="flex items-center gap-2">
      <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">{banner.message}</span>
      {banner.linkPath && <span className="whitespace-nowrap underline underline-offset-2">See more</span>}
    </span>
  );
  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-gradient-to-r from-amber-500/20 to-fuchsia-500/20 px-3 py-2 text-xs text-amber-100" role="note" data-testid="home-banner">
      {banner.linkPath ? <Link href={banner.linkPath} className="min-w-0">{body}</Link> : body}
      <button type="button" onClick={() => setHiddenId(banner.id)} aria-label="Dismiss" className="shrink-0 rounded p-1 hover:bg-white/10">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
