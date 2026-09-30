"use client";

import { clearCache } from "@/lib/offline-cache";

/**
 * Revoke the server-side session, then hard-navigate so every in-memory
 * cache (React Query, component state) from this account is discarded.
 */
export async function signOut() {
  clearCache();
  try {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  } finally {
    window.location.assign("/");
  }
}

/** Send a visitor whose session is missing/expired back to sign-in. */
export function redirectToSignIn() {
  clearCache();
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`);
}
