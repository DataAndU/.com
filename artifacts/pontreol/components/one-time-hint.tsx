"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { hasSeen, markSeen } from "@/lib/onboarding";

/**
 * Small dismissible tip, shown once per device. Pass several ids in order:
 * only the first unseen one appears, so tips never stack.
 */
export function OneTimeHint({ hints, className = "", dismissRef }: {
  hints: { id: string; text: string }[];
  className?: string;
  /** Lets the page mark a hint done when the user performs the action. */
  dismissRef?: React.MutableRefObject<((id: string) => void) | null>;
}) {
  const [current, setCurrent] = useState<{ id: string; text: string } | null>(null);
  const ids = hints.map((h) => h.id).join("|");

  useEffect(() => {
    setCurrent(hints.find((h) => !hasSeen(`hint:${h.id}`)) ?? null);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dismissRef) return;
    dismissRef.current = (id: string) => {
      markSeen(`hint:${id}`);
      setCurrent((c) => (c?.id === id ? hints.find((h) => !hasSeen(`hint:${h.id}`)) ?? null : c));
    };
  }, [dismissRef, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null;
  const close = () => { markSeen(`hint:${current.id}`); setCurrent(null); };
  return (
    <div role="status" className={`flex items-center gap-2 rounded-xl bg-foreground text-background px-3 py-2 text-sm shadow-lg ${className}`}>
      <span className="flex-1">{current.text}</span>
      <button type="button" onClick={close} aria-label="Dismiss tip" className="p-1 opacity-80"><X className="h-4 w-4" /></button>
    </div>
  );
}
