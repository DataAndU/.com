import { redirect } from "next/navigation";

// Search now lives on Explore (/home). Old links keep their filters.
export default async function DiscoverRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const next = new URLSearchParams();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  if (one(p.q)) next.set("q", one(p.q)!);
  if (one(p.category)) next.set("category", one(p.category)!);
  if (one(p.now) === "1") next.set("when", "now");
  redirect(`/home${next.size ? `?${next}` : ""}`);
}
