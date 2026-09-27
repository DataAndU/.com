"use client";

import { ClerkLoaded } from "@clerk/nextjs";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function AuthLoading({ children, action }: { children: ReactNode; action: string }) {
  const [timedOut, setTimedOut] = useState(false);
  const [formReady, setFormReady] = useState(false);
  const formContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimedOut(true), 12000);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const container = formContainer.current;
    if (!container) return;
    // ClerkLoaded means its SDK initialized, not that its sign-in UI rendered.
    // Observe both so a stalled widget cannot leave an empty dark page.
    const check = () => {
      if (container.querySelector(".cl-card input, .cl-card button, form input, [role='alert']")) {
        setFormReady(true);
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(container, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-4">
      <div ref={formContainer} className={formReady ? "" : "sr-only"} aria-hidden={!formReady}>
        <ClerkLoaded>{children}</ClerkLoaded>
      </div>
      {!formReady && (
        <div role="status" className="w-full max-w-md rounded-2xl border border-[#2a2d33] bg-[#16181A] px-7 py-9 text-center text-white shadow-2xl">
          <img src="/logo.svg" alt="Pontreol" className="mx-auto mb-6 h-10 max-w-40" />
          <h1 className="text-xl font-semibold">{timedOut ? `Unable to load ${action}` : `Loading ${action}…`}</h1>
          <p className="mt-3 text-sm text-gray-400">
            {timedOut
              ? "Your browser could not load the secure sign-in form. Please retry. If this keeps happening, clear cached site data for Pontreol and try again."
              : "Connecting securely to your account."}
          </p>
          {timedOut && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-lg bg-[#218075] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2A9D8F]"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}