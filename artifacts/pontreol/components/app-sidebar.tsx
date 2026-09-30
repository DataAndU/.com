"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Compass, Plus, Inbox, UserRound } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { AvailabilityToggle } from "@/components/availability-toggle";
import { LanguagePicker, useT } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";

// Four destinations only. Secondary screens live inside Inbox and Profile.
const TABS = [
  { label: "explore" as const, path: "/home", icon: Compass, match: ["/home", "/discover", "/providers", "/bundles"] },
  { label: "post" as const, path: "/listings?new=1", icon: Plus, match: ["/listings"], primary: true },
  { label: "inbox" as const, path: "/messages", icon: Inbox, match: ["/messages", "/requests", "/notifications"] },
  { label: "profile" as const, path: "/settings", icon: UserRound, match: ["/settings", "/billing", "/admin", "/verification", "/safety"] },
];

function isActive(pathname: string, match: string[]) {
  return match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

export function AppSidebar() {
  const pathname = usePathname();
  const t = useT();

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-2 border-b border-border bg-background shrink-0">
        <Link href="/home" className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="w-7 h-7" />
          <span className="font-semibold tracking-tight">Pontreol</span>
        </Link>
        <AccountMenu size={8} />
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-background">
        <Link href="/home" className="flex items-center gap-2.5 px-5 py-5">
          <img src="/logo.svg" alt="" className="w-8 h-8" />
          <span className="font-semibold text-lg tracking-tight">Pontreol</span>
        </Link>
        <nav className="flex-1 px-3 space-y-1" aria-label="Main">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.match);
            return (
              <Link key={tab.label} href={tab.path}
                className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
                  tab.primary ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : active ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground")}>
                <tab.icon className="w-5 h-5" />
                {tab.primary ? t("postAvailability") : t(tab.label)}
              </Link>
            );
          })}
          <div className="pt-4"><AvailabilityToggle /></div>
        </nav>
        <div className="p-3 flex gap-2"><LanguagePicker className="flex-1 min-w-0" /><ThemeToggle /></div>
      </aside>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        <div className="grid grid-cols-4">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.match);
            return (
              <Link key={tab.label} href={tab.path}
                className={cn("flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                {tab.primary
                  ? <span className="flex h-7 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground"><tab.icon className="w-5 h-5" /></span>
                  : <tab.icon className="w-6 h-6" />}
                <span>{tab.primary ? `+ ${t("post")}` : t(tab.label)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
