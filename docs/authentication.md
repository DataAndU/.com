# Authentication: email one-time code (OTP)

Pontreol signs users in with an emailed 6-digit code, then keeps its own
server-side session in PostgreSQL. There are no passwords, magic links, SMS codes,
Google sign-in or Clerk.

## Flow

1. On `/sign-in` the user enters an email → `POST /api/auth/otp/request`.
   - The email is normalized (trimmed, lower-cased) and validated.
   - A code is generated with `secrets` and stored only as a salted scrypt hash
     (`email_otp_challenges`). It expires in 10 minutes, and any earlier code for that
     email is invalidated.
   - The code is emailed **directly** through Resend. It never goes through the
     notification outbox, so it is never stored in plaintext.
   - The response is identical whether or not an account exists, so it doesn't reveal
     which emails are registered. No account is created at this step.
2. The user types the code → `POST /api/auth/otp/verify` (`{email, code, next}`).
   - The latest unused challenge for that email is locked and checked in constant time.
   - A wrong code adds an attempt. The 5th wrong attempt burns the code.
   - An expired code is burned too.
   - A correct code is marked used **before** anything else happens (single use,
     replay-proof).
   - The account is found by normalized email, or created now (see below).
   - Suspended accounts are refused.
   - Any session cookie the browser already had is revoked (session rotation), and a
     new session is created.
3. The browser receives `__Host-pontreol_session`: a random opaque token with the
   attributes HttpOnly, Secure, SameSite=Lax, Path=/ and a 30-day lifetime. Only its
   SHA-256 hash is stored (`auth_sessions`). Nothing is kept in `localStorage`.
4. Every API request re-checks the session, suspension, role and admin flag in the
   database (`deps.current_user`).
5. `POST /api/auth/logout` revokes the session server-side and clears the cookie. The
   page then fully reloads, so no data from that account stays in memory.

## Limits

| Limit | Value |
|---|---|
| Code lifetime | 10 minutes, single use |
| Wrong attempts per code | 5 (then the code is burned) |
| Resend cooldown per email | 60 seconds |
| Codes per email per hour | 5 |
| Codes requested per client IP per hour | 20 |
| Wrong codes per client IP per hour | 30 |

Over-limit requests get `429 rate_limited` with `Retry-After`. Client IPs (first
`X-Forwarded-For` hop) are stored only as hashes. Challenges and rate events older
than a day are deleted automatically.

## CSRF and privacy

- Every auth call (request, verify, logout) and every other cookie-authenticated
  mutation must carry an `Origin` matching `ALLOWED_ORIGINS` or
  `Sec-Fetch-Site: same-origin`. Cross-site requests, or requests with neither header,
  get 403. SameSite=Lax adds a second layer.
- Codes are never logged, never put in URLs and never returned by the API. Emails are
  not written to logs either. A test asserts that neither appears in any log record.

## Existing accounts

The login identity is the normalized email.
- When exactly one user's email matches (case-insensitive), that user is signed in to
  their **existing** account. Role, admin status, listings, requests, messages,
  payments and profile are all unchanged.
- When no user matches, a new account is created **after** successful verification,
  and the user goes to onboarding to choose a role.
- When two or more accounts share the email (legacy duplicates), sign-in is refused with
  `409 account_conflict` and a warning is logged (without the email). An operator must
  resolve it manually. Accounts are never merged automatically.
- First sign-ins for the same new email are serialized with a PostgreSQL advisory lock,
  so racing requests cannot create duplicates.
- `users.clerk_user_id` and `users.google_sub` are kept unchanged for history and
  rollback. They are not used for authentication.

Admins are granted by email: `python python/grant_admin.py person@example.com`.

## Configuration

Sign-in needs Resend:
- `RESEND_API_KEY` (secret, api component)
- `RESEND_FROM=Pontreol <notifications@pontreol.com>`, with the `pontreol.com` domain
  verified in Resend

Without them, `/api/auth/otp/request` returns `503 email_unavailable`. No Google or
Clerk variables are used for authentication. (Photos use DigitalOcean Spaces:
`SPACES_*`.)

## Database migrations

All migrations are additive and safe to re-run:
- `0002_native_google_auth.sql`: `auth_sessions`, the `google_sub` column, and
  `oauth_login_attempts` (no longer used, kept)
- `0003_email_otp_auth.sql`: `email_otp_challenges` and `auth_rate_events`

Run them from the App Platform **api** Console with:

```
python python/apply_migrations.py
```

## Rollback

Redeploy the previous release (App → Activity → Rollback). Sessions stay valid across
versions, since they use the same table and cookie. The new tables can stay in place.
