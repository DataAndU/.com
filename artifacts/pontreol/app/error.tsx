"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Pontreol page failed", error);
  }, [error]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <div role="alert" className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold">This page could not load</h1>
        <p className="mt-3 text-sm text-muted-foreground">Please try again. If the problem continues, reload the page.</p>
        <button onClick={reset} className="mt-6 rounded-lg bg-primary px-5 py-2 text-primary-foreground">Try again</button>
      </div>
    </main>
  );
}