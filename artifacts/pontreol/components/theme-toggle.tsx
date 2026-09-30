"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [light, setLight] = useState(false);
  useEffect(() => { setLight(document.documentElement.classList.contains("light")); }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    const root = document.documentElement;
    root.classList.toggle("light", next);
    root.classList.toggle("dark", !next);
    try { localStorage.setItem("pontreol-theme", next ? "light" : "dark"); } catch {}
  };

  return (
    <button type="button" onClick={toggle} aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className={`h-9 w-9 shrink-0 rounded-md border border-border bg-input flex items-center justify-center ${className}`}>
      {light ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
