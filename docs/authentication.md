# Authentication: native Google sign-in

Clerk has been removed. Pontreol signs users in with Google (OpenID Connect,
authorization-code flow with PKCE) and keeps its own server-side sessions in
PostgreSQL. Google-only: there are no passwords, SMS codes or other providers.

## Flow

1. The **Continue with Google** link on `/sign-in` opens `GET /api/auth/google/start?next=/wherever`.
2. The API creates a one-time login attempt (random `state`, `nonce` and PKCE verifier) and
   stores it in `oauth_login_attempts`. It sets an HttpOnly `__Host-pontreol_login`
   cookie that binds the attempt to this browser, then redirects to Google.
3. Google redirects to `GET /api/auth/google/callback?code&state`. The API:
   - consumes the attempt (single use, 10-minute lifetime, bound to the login cookie) and
     compares `state` in constant time (login-CSRF and replay protection);
   - exchanges the code with the client secret and PKCE verifier (server-to-server);
   - verifies the ID token's RS256 signature against Google's JWKS (from Google's OIDC
     discovery document), plus issuer, audience/`azp`, expiry, `nonce`, and
     `email_verified === true`;
   - finds or links the Pontreol user (below), refuses suspended accounts, revokes any
     session cookie the browser already had (session-fixation defence), and creates a new
     session.
4. The browser receives `__Host-pontreol_session`, a random 256-bit opaque token with the
   attributes HttpOnly, Secure, SameSite=Lax, Path=/ and a 30-day lifetime. Only its SHA-256
   hash is stored (`auth_sessions`). Google tokens are never stored or sent to the browser,
   and the client secret exists only in the API.
5. On every request, `deps.current_user` loads the session and user in one query and rejects
   anything expired, revoked, suspended or role-less (except `/api/me`). Roles, admin status,
   ownership and payments are always decided by the database.
6. `POST /api/auth/logout` (same-origin only) revokes the session row and clears the cookie.
   The frontend then does a full page load, so no cached data from that account survives.

In development (without `NODE_ENV=production`), the cookies are named
`pontreol_session`/`pontreol_login` without `Secure`, so `http://localhost` works.

## CSRF

- Every cookie-authenticated POST/PUT/PATCH/DELETE must carry `Origin` matching
  `ALLOWED_ORIGINS` or `Sec-Fetch-Site: same-origin`. Requests with neither are rejected, and
  `same-site` (a sibling subdomain) is no longer accepted.
- SameSite=Lax additionally stops cross-site POSTs from carrying the cookie.
- The Razorpay webhook is authenticated by its HMAC signature, not by cookies.

## Existing (Clerk-era) accounts

Existing users keep their account, role, listings, bookings, messages and payments.
The first time they sign in with Google, the API looks them up in this order:

1. `users.google_sub` equals Google's `sub`: signed in.
2. Otherwise, exactly one user whose email equals Google's **verified** email
   (case-insensitive) and who has no Google identity yet: linked, `google_sub` is saved,
   then signed in. Clerk only ever stored verified primary emails.
3. Otherwise, a new account is created (role chosen at onboarding).

These cases are refused (with a generic error, never merged):

- the email is unverified;
- two or more existing accounts share the email;
- the email already belongs to a *different* Google account.

`users.clerk_user_id` is kept unchanged for audit and rollback. It is no longer used for
sign-in. A user whose Clerk email differs from their Google email gets a new account. An
operator can resolve that case manually.

Admins are granted by email: `python python/grant_admin.py person@example.com`.

## Google Cloud Console setup

1. **APIs & Services → OAuth consent screen:** choose External, fill in the app name
   (Pontreol), support email and the `pontreol.com` domain. Scopes: `openid`, `email`,
   `profile`. Publish the app (move it from Testing to In production).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://pontreol.com`
   - Authorized redirect URIs: `https://pontreol.com/api/auth/google/callback`
3. Copy the **Client ID** to `GOOGLE_CLIENT_ID` (not secret) and the **Client secret** to
   `GOOGLE_CLIENT_SECRET` (secret, encrypted), both on the **api** component.

## Database migration

`artifacts/api-server/migrations/0002_native_google_auth.sql` is additive:
- adds `users.google_sub`
- makes `clerk_user_id` nullable
- creates `auth_sessions` and `oauth_login_attempts`, plus indexes

Nothing is dropped. Run it once, before or together with the first deploy of this version,
from the api component's Console:

```
python python/apply_migrations.py
```

## Rollback

1. Redeploy the previous commit (App → Activity → Rollback). Clerk users still have
   `clerk_user_id`, so Clerk sign-in works again once the Clerk variables are restored.
2. The new tables and column can stay; the old code ignores them. Accounts created while
   native sign-in was live have no `clerk_user_id`, and would need Clerk to create them again.
