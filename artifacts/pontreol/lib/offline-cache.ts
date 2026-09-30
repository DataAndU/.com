// Last results kept on this device so screens show something instantly on
// slow 3G or offline, then refresh. Only public listing data is stored.
const PREFIX = "pontreol-cache:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 8;

export function readCache<T>(key: string): { data: T; savedAt: number } | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as { data: T; savedAt: number };
    return Date.now() - entry.savedAt < MAX_AGE_MS ? entry : undefined;
  } catch { return undefined; }
}

export function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
    if (keys.length > MAX_ENTRIES) {
      keys.map((k) => ({ k, t: (JSON.parse(localStorage.getItem(k) || "{}").savedAt as number) || 0 }))
        .sort((a, b) => a.t - b.t).slice(0, keys.length - MAX_ENTRIES)
        .forEach(({ k }) => localStorage.removeItem(k));
    }
  } catch { /* storage full or blocked: caching is optional */ }
}

/** Forget every saved result (on sign-out or an expired session). */
export function clearCache() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch {}
}
