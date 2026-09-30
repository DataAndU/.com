"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMe, useUpdateRole } from "@/lib/api/account";

/** One account, two modes. Switching is instant and can be undone any time. */
export function ModeSwitch({ className = "" }: { className?: string }) {
  const { data: user } = useMe();
  const update = useUpdateRole();
  const queryClient = useQueryClient();
  if (!user?.role) return null;
  const set = (role: "buyer" | "provider") => {
    if (role === user.role) return;
    update.mutate({ role }, { onSuccess: () => void queryClient.invalidateQueries() });
  };
  const btn = (active: boolean) =>
    `flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors ${active ? "bg-foreground text-background" : "text-muted-foreground"}`;
  return (
    <div className={className}>
      <div className="flex gap-1 rounded-xl border border-border p-1" role="group" aria-label="Mode">
        <button type="button" className={btn(user.role === "buyer")} aria-pressed={user.role === "buyer"} disabled={update.isPending} onClick={() => set("buyer")} data-testid="mode-find">🔍 Find</button>
        <button type="button" className={btn(user.role === "provider")} aria-pressed={user.role === "provider"} disabled={update.isPending} onClick={() => set("provider")} data-testid="mode-provide">➕ Provide</button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {user.role === "buyer" ? "Find mode: search, book and chat with providers." : "Provide mode: post availability and answer requests."} Switch any time.
      </p>
      {update.isError && <p role="alert" className="mt-1 text-xs text-red-500">{update.error.message}</p>}
    </div>
  );
}
