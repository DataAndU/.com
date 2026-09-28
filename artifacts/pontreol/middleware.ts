import { NextResponse, type NextRequest } from 'next/server';

// Session cookie names issued by the API (api-server/python/auth.py).
const SESSION_COOKIES = ['__Host-pontreol_session', 'pontreol_session'];
const PUBLIC_PATHS = [/^\/$/, /^\/sign-in(\/.*)?$/, /^\/sign-up(\/.*)?$/, /^\/api(\/.*)?$/];

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

function trustedHost(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = (forwarded || request.headers.get('host') || '').toLowerCase().replace(/:\d+$/, '');
  if (!host) return false;
  if (process.env.NODE_ENV !== 'production' || host === 'localhost' || host === '127.0.0.1') return true;
  return configuredHosts().has(host);
}

/**
 * UX gate only: a missing session cookie redirects to /sign-in before any page
 * renders. Whether a cookie is valid is decided by the API on every request
 * (RoleGuard sends expired sessions back to /sign-in).
 */
export default function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Hosting probes must not depend on host checks or sessions.
  if (pathname === '/healthz') return NextResponse.next();
  if (!trustedHost(request)) return new NextResponse('Invalid Host', { status: 400 });

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (pathname === '/' && hasSession) {
    return NextResponse.redirect(new URL('/home', request.url));
  }
  if (!hasSession && !PUBLIC_PATHS.some((pattern) => pattern.test(pathname))) {
    const signIn = new URL('/sign-in', request.url);
    signIn.searchParams.set('next', pathname + search);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
