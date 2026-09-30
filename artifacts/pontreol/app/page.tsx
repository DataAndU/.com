"use client";

import Link from "next/link";
import { LanguagePicker, useT } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tutorial } from "@/components/tutorial";
import { hasSeen, markSeen, TUTORIAL } from "@/lib/onboarding";

// Visitors with a session cookie are sent to /home by middleware.
export default function LandingPage() {
  const t = useT();
  const router = useRouter();
  const [showTutorial, setShowTutorial] = useState(false);
  // First visit: explain the idea before any sign-in.
  useEffect(() => { if (!hasSeen(TUTORIAL)) setShowTutorial(true); }, []);
  const finish = (next: "explore" | "post" | "skip") => {
    markSeen(TUTORIAL);
    setShowTutorial(false);
    if (next === "explore") router.push("/home");
    if (next === "post") router.push("/listings?new=1");
  };
  const categories = [
    { label: t("cat.services") },
    { label: t("cat.delivery") },
    { label: t("cat.travel") },
    { label: t("cat.spaces") },
  ];

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground">
      {showTutorial && <Tutorial onDone={finish} />}
      <div className="flex justify-end gap-2 p-4"><LanguagePicker /><ThemeToggle /></div>
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16 text-center">
        <img src="/logo.svg" alt="" className="w-16 h-16 mb-5" />
        <h1 className="text-3xl font-semibold tracking-tight">Pontreol</h1>
        <p className="mt-3 max-w-xs text-lg text-muted-foreground">{t("tagline")}</p>
        <p className="mt-6 max-w-xs text-sm text-muted-foreground">
          {categories.map((c) => c.label).join(" · ")}
        </p>
        <Link href="/sign-in"
          className="mt-10 w-full max-w-xs flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground active:scale-[0.98] transition-transform">
          {t("signInToContinue")} <ChevronRight className="w-5 h-5" />
        </Link>
        <p className="mt-4 text-xs text-muted-foreground">New here? The same button creates your free account.</p>
        <button type="button" onClick={() => setShowTutorial(true)} className="mt-3 text-xs text-primary underline">How Pontreol works</button>
      </main>
    </div>
  );
}
