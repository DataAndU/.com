"use client";
import { useT } from "@/lib/i18n";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "chats" as const, path: "/messages" },
  { label: "bookings" as const, path: "/requests" },
  { label: "alerts" as const, path: "/notifications" },
];

/** Inbox = chats, bookings and alerts in one place. */
export function InboxTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <div className="shrink-0 border-b border-border bg-background px-4 pt-3">
      <h1 className="text-xl font-semibold">{t("inbox")}</h1>
      <nav className="mt-2 flex gap-5 text-sm" aria-label="Inbox">
        {TABS.map((tb) => {
          const active = pathname === tb.path || pathname.startsWith(`${tb.path}/`);
          return (
            <Link key={tb.path} href={tb.path} aria-current={active ? "page" : undefined}
              className={`pb-2 border-b-2 font-medium ${active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"}`}>
              {t(tb.label)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
