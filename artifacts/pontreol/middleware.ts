import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import {
  isDevelopmentFromPublishableKey,
  publishableKeyFromHost,
} from '@clerk/shared/keys';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';

const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)', '/api(.*)']);

function configuredHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const value of [
    process.env.REPLIT_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS || '').split(','),
  ]) {
    const host = value?.trim().toLowerCase().replace(/:\d+$/, '');
    if (host) hosts.add(host);
  }
  for (const value of (process.env.ALLOWED_ORIGINS || '').split(',')) {
    try {
      hosts.add(new URL(value.trim()).hostname.toLowerCase());
    } catch {
      // Malformed configuration is never treated as a trusted host.
    }
  }
  return hosts;
}

function effectiveHost(request: NextRequest, fallbackKey: string): string | null {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = (forwarded || request.headers.get('host') || '').toLowerCase().replace(/:\d+$/, '');
  if (!host) return null;
  if (isDevelopmentFromPublishableKey(fallbackKey) || host === 'localhost' || host === '127.0.0.1') {
    return host;
  }
  return configuredHosts().has(host) ? host : null;
}

function clerkOptions(request: NextRequest) {
  const fallbackKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || '';
  if (!fallbackKey) throw new Error('Clerk publishable key is not configured');
  const host = effectiveHost(request, fallbackKey);
  const publishableKey = host ? publishableKeyFromHost(host, fallbackKey) : fallbackKey;
  const proxyUrl =
    process.env.NEXT_PUBLIC_CLERK_PROXY_URL ?? process.env.CLERK_PROXY_URL ?? '';
  return { publishableKey, proxyUrl: proxyUrl || undefined };
}

const clerkHandler = clerkMiddleware(
  async (auth, req) => {
    const fallbackKey =
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || '';
    if (!fallbackKey) {
      return new NextResponse('Authentication is not configured', { status: 503 });
    }
    if (!effectiveHost(req, fallbackKey)) {
      return new NextResponse('Invalid Host', { status: 400 });
    }
    if (!isPublicRoute(req)) {
      const { userId } = await auth();
      if (!userId) {
        // Clerk's default protect response can be a 404 for page requests
        // without a configured sign-in URL. Direct protected URLs should
        // send visitors to the existing local sign-in route instead.
        return NextResponse.redirect(new URL('/sign-in', req.url));
      }
    }
  },
  clerkOptions,
);

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // Hosting probes must not depend on Clerk keys, host checks, or sessions.
  // All other routes retain their existing authentication rules.
  if (request.nextUrl.pathname === '/healthz') {
    return NextResponse.next();
  }
  return clerkHandler(request, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};