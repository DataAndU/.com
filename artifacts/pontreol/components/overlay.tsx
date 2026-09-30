"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Renders dialogs at the top of the page so no bar or map can cover them. */
export function Overlay({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
