"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Pontreol application failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#101214", color: "white", fontFamily: "sans-serif" }}>
        <main role="alert" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1>Pontreol could not load</h1>
            <p>Please retry. If this continues, reload the page or clear cached site data for Pontreol.</p>
            <button onClick={reset} style={{ padding: "12px 20px", background: "#218075", color: "white", border: 0, borderRadius: 8 }}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}