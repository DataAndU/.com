"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellRing, Check, Loader2 } from "lucide-react";
import { fetchApi, type Page } from "@/lib/api/client";
import {
  useMarkNotificationRead,
  useNotificationPreferences,
  useNotifications,
  useUpdateNotificationPreferences,
} from "@/lib/api/account";

type Preference = {
  emailBookings: boolean;
  emailMessages: boolean;
  browserBookings: boolean;
  browserMessages: boolean;
};

type Notice = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

const preferenceLabels: Array<[keyof Preference, string]> = [
  ["emailBookings", "Booking updates by email"],
  ["emailMessages", "New messages by email"],
  ["browserBookings", "Booking browser alerts"],
  ["browserMessages", "Message browser alerts"],
];

export function NotificationCenter() {
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const notifications = useQuery<Page<Notice>>({
    queryKey: ["notifications", cursor, 25],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      return fetchApi(`/notifications?${params.toString()}`);
    },
  });
  const preferences = useNotificationPreferences();
  const markRead = useMarkNotificationRead();
  const updatePreferences = useUpdateNotificationPreferences();
  const [draft, setDraft] = useState<Preference | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    if (preferences.data) setDraft(preferences.data as Preference);
  }, [preferences.data]);

  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  async function askPermission() {
    if (!("Notification" in window)) return;
    setPermission(await Notification.requestPermission());
  }

  function savePreferences(next: Preference) {
    setDraft(next);
    updatePreferences.mutate(next);
  }

  if (notifications.isLoading || preferences.isLoading) {
    return <div className="flex min-h-48 items-center justify-center" data-testid="status-notifications-loading"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const loadError = notifications.error || preferences.error;
  if (loadError) {
    return <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-red-300" data-testid="status-notifications-error">{loadError.message}</p>;
  }

  const items = (notifications.data?.items || []) as Notice[];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="panel-notifications">
        <header className="flex items-center gap-3 border-b border-border p-5">
          <BellRing className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">Notifications</h2>
            <p className="text-xs text-muted-foreground">{items.filter((item) => !item.readAt).length} unread</p>
          </div>
        </header>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <article className={`flex gap-3 p-5 ${item.readAt ? "opacity-65" : "bg-primary/5"}`} key={item.id} data-testid={`notification-${item.id}`}>
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium" data-testid={`text-notification-title-${item.id}`}>{item.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                <time className="mt-2 block text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</time>
              </div>
              {!item.readAt && (
                <button type="button" data-testid={`button-read-notification-${item.id}`} aria-label={`Mark ${item.title} read`} disabled={markRead.isPending} onClick={() => markRead.mutate({ id: item.id })} className="h-fit rounded-lg border border-border p-2 text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50">
                  <Check className="h-4 w-4" />
                </button>
              )}
            </article>
          ))}
          {items.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground" data-testid="status-notifications-empty">No notifications yet.</p>}
        </div>
        {(cursor || notifications.data?.nextCursor || cursorHistory.length > 0) && (
          <nav className="flex items-center justify-between border-t border-border p-4" aria-label="Notification pagination">
            <button type="button" data-testid="button-previous-notifications" disabled={notifications.isFetching || cursorHistory.length === 0} onClick={() => { const prior = cursorHistory[cursorHistory.length - 1]; setCursor(prior || undefined); setCursorHistory(cursorHistory.slice(0, -1)); }} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">Previous</button>
            <span className="text-xs text-muted-foreground">Cursor page {cursorHistory.length + 1}</span>
            <button type="button" data-testid="button-next-notifications" disabled={notifications.isFetching || !notifications.data?.nextCursor} onClick={() => { const next = notifications.data?.nextCursor; if (next) { setCursorHistory([...cursorHistory, cursor || ""]); setCursor(next); } }} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">Next</button>
          </nav>
        )}
      </section>

      <aside className="h-fit rounded-xl border border-border bg-card p-5" data-testid="panel-notification-preferences">
        <h2 className="font-semibold">Preferences</h2>
        <p className="mt-1 text-xs text-muted-foreground">Choose which updates you receive.</p>
        <div className="mt-5 space-y-4">
          {draft && preferenceLabels.map(([key, label]) => (
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm" key={key}>
              <span>{label}</span>
              <input data-testid={`toggle-${key}`} type="checkbox" checked={draft[key]} disabled={updatePreferences.isPending} onChange={(event) => savePreferences({ ...draft, [key]: event.target.checked })} className="h-4 w-4 accent-primary" />
            </label>
          ))}
        </div>
        {(draft?.browserBookings || draft?.browserMessages) && permission !== "granted" && (
          <button type="button" data-testid="button-enable-browser-notifications" onClick={askPermission} disabled={permission === "unsupported"} className="mt-5 w-full rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50">
            {permission === "unsupported" ? "Browser alerts unsupported" : permission === "denied" ? "Alerts blocked in browser" : "Allow browser alerts"}
          </button>
        )}
        {updatePreferences.error && <p className="mt-3 text-xs text-red-300" data-testid="status-preference-error">{updatePreferences.error.message}</p>}
      </aside>
    </div>
  );
}

/**
 * Mount once in the signed-in layout so foreground alerts continue on every
 * authenticated route. This intentionally renders no UI.
 */
export function ForegroundNotifications() {
  const notifications = useNotifications();
  const preferences = useNotificationPreferences();
  const shownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    const prefs = preferences.data as Preference | undefined;
    if (!prefs || (!prefs.browserBookings && !prefs.browserMessages)) return;
    const poll = () => {
      if (document.visibilityState === "visible") void notifications.refetch();
    };
    const interval = window.setInterval(poll, 20_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [preferences.data, notifications.refetch]);

  useEffect(() => {
    const items = (notifications.data?.items || []) as Notice[];
    if (shownIds.current === null) {
      shownIds.current = new Set(items.map((item) => item.id));
      return;
    }
    const prefs = preferences.data as Preference | undefined;
    for (const item of items) {
      const isMessage = item.type.toLowerCase().includes("message");
      const allowed = isMessage ? prefs?.browserMessages : prefs?.browserBookings;
      if (!shownIds.current.has(item.id) && !item.readAt && allowed && "Notification" in window && Notification.permission === "granted" && document.visibilityState === "visible") {
        new Notification(item.title, { body: item.body, tag: item.id });
      }
      shownIds.current.add(item.id);
    }
  }, [notifications.data, preferences.data]);

  return null;
}