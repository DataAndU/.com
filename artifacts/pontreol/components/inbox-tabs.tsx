"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Chats", path: "/messages" },
  { label: "Bookings", path: "/requests" },
  { label: "Alerts", path: "/notifications" },
];

/** Inbox = chats, bookings and alerts in one place. */
export function InboxTabs() {
  const pathname = usePathname();
  return (
    <div className="shrink-0 border-b border-border bg-background px-4 pt-3">
      <h1 className="text-xl font-semibold">Inbox</h1>
      <nav className="mt-2 flex gap-5 text-sm" aria-label="Inbox">
        {TABS.map((t) => {
          const active = pathname === t.path || pathname.startsWith(`${t.path}/`);
          return (
            <Link key={t.path} href={t.path} aria-current={active ? "page" : undefined}
              className={`pb-2 border-b-2 font-medium ${active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
