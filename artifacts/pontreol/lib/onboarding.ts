// One-time UI flags kept on this device only (clearing site data shows them again).
const PREFIX = "pontreol-seen:";

export function hasSeen(key: string) {
  try { return localStorage.getItem(PREFIX + key) === "1"; } catch { return true; }
}

export function markSeen(key: string) {
  try { localStorage.setItem(PREFIX + key, "1"); } catch { /* storage blocked: fine */ }
}

export function forget(key: string) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

export const TUTORIAL = "tutorial";
