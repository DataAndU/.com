import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { Providers } from "@/components/providers";
import "./globals.css";

import { headers } from "next/headers";
import {
  isDevelopmentFromPublishableKey,
  publishableKeyFromHost,
} from "@clerk/shared/keys";

export const metadata: Metadata = {
  title: "Pontreol",
  description: "Connect locally for everything you need.",
};

const clerkAppearance = {
  baseTheme: dark,
  layout: {
    logoImageUrl: "/logo.svg",
    logoPlacement: "inside" as const,
  },
  variables: {
    colorPrimary: "hsl(173 58% 39%)", // Teal #2A9D8F
    colorBackground: "hsl(210 8% 9%)", // #16181A
    colorInput: "hsl(210 8% 15%)",
    colorInputForeground: "white",
    colorText: "white",
    colorNeutral: "hsl(210 8% 20%)",
    borderRadius: "0.5rem",
  },
  elements: {
    card: "bg-[#16181A] border border-[#2a2d33] shadow-2xl rounded-2xl",
    headerTitle: "text-white font-semibold",
    headerSubtitle: "text-gray-400",
    formFieldLabel: "text-white",
    formFieldInput: "bg-[#2a2d33] border-[#2a2d33] text-white",
    socialButtonsBlockButton: "border-[#2a2d33] hover:bg-white/5",
    socialButtonsBlockButtonText: { color: "#FFFFFF" },
    formButtonPrimary: { backgroundColor: "#218075", color: "#FFFFFF" },
  }
};

function configuredHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const value of [
    process.env.REPLIT_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS || "").split(","),
  ]) {
    const host = value?.trim().toLowerCase().replace(/:\d+$/, "");
    if (host) hosts.add(host);
  }
  for (const value of (process.env.ALLOWED_ORIGINS || "").split(",")) {
    try {
      hosts.add(new URL(value.trim()).hostname.toLowerCase());
    } catch {
      // Ignore malformed configuration rather than trusting it as a host.
    }
  }
  return hosts;
}

function effectiveHost(h: Headers, fallbackKey: string): string {
  const forwarded = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (forwarded || h.get("host") || "").toLowerCase().replace(/:\d+$/, "");
  if (!host) throw new Error("Missing public request host");
  if (isDevelopmentFromPublishableKey(fallbackKey) || host === "localhost" || host === "127.0.0.1") {
    return host;
  }
  if (!configuredHosts().has(host)) {
    throw new Error("Unrecognized public request host");
  }
  return host;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const h = await headers();
  const fallbackKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    "";
  if (!fallbackKey) throw new Error("Clerk publishable key is not configured");
  const host = effectiveHost(h, fallbackKey);
  const clerkPubKey = publishableKeyFromHost(
    host,
    fallbackKey
  );
  const clerkProxyUrl =
    process.env.NEXT_PUBLIC_CLERK_PROXY_URL ?? process.env.CLERK_PROXY_URL ?? "";
  // Clerk's client provider also renders during SSR. Its script URL builder
  // resolves relative proxy paths against window.location, which is absent
  // on the server; use the validated request host for a same-origin URL.
  const providerProxyUrl = clerkProxyUrl.startsWith("/")
    ? `https://${host}${clerkProxyUrl}`
    : clerkProxyUrl;
  // The previous proxy delivered encoded bytes without Content-Encoding.
  // Clerk's versioned JS is immutable for a year, so affected browsers need
  // a new URL after the transport fix. Dev has no proxy and uses Clerk's default.
  const clerkJSUrl = providerProxyUrl
    ? `${providerProxyUrl}/npm/@clerk/clerk-js@5/dist/clerk.browser.js?pontreol_clerk_cache=identity-1`
    : undefined;

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={providerProxyUrl || undefined}
      clerkJSUrl={clerkJSUrl}
      appearance={clerkAppearance}
    >
      <html lang="en" className="dark">
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}