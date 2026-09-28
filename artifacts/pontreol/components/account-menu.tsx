"use client";

import Link from "next/link";
import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { useMe } from "@/lib/api/account";
import { signOut } from "@/lib/auth";

/** Account avatar menu: profile link + sign out. */
export function AccountMenu({ size = 8 }: { size?: 8 | 10 }) {
  const { data: user } = useMe();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const box = size === 10 ? "w-10 h-10" : "w-8 h-8";

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label="Account menu" aria-expanded={open}
        className={`${box} rounded-full overflow-hidden border border-border bg-secondary flex items-center justify-center`}>
        {user?.avatarUrl
          ? <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          : <UserRound className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-auto md:bottom-12 md:left-0 md:right-auto z-50 mt-2 w-56 rounded-xl border border-border bg-card p-2 shadow-xl">
            {user && <p className="truncate px-3 py-2 text-xs text-muted-foreground">{user.email}</p>}
            <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5">
              <UserRound className="w-4 h-4" /> Manage profile
            </Link>
            <button type="button" disabled={signingOut} onClick={() => { setSigningOut(true); void signOut(); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50" data-testid="button-sign-out">
              <LogOut className="w-4 h-4" /> {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
