const allowedDevOrigins = new Set(["localhost", "127.0.0.1"]);
for (const value of [
  process.env.REPLIT_DEV_DOMAIN,
  ...(process.env.REPLIT_DOMAINS || "").split(","),
]) {
  const host = value?.trim().toLowerCase().replace(/:\d+$/, "");
  if (host) allowedDevOrigins.add(host);
}
for (const value of (process.env.ALLOWED_ORIGINS || "").split(",")) {
  try {
    allowedDevOrigins.add(new URL(value.trim()).hostname.toLowerCase());
  } catch {
    // Ignore malformed configuration rather than allowing it as a dev origin.
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Restrict cross-origin dev assets/HMR to local preview and configured
  // Replit hosts. This is intentionally not a wildcard.
  allowedDevOrigins: [...allowedDevOrigins],
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
    // Replit injects the server-side name. Next must explicitly expose the
    // canonical production proxy path to Clerk's browser runtime.
    NEXT_PUBLIC_CLERK_PROXY_URL:
      process.env.NEXT_PUBLIC_CLERK_PROXY_URL ?? process.env.CLERK_PROXY_URL ?? "",
  }
};

export default nextConfig;
