# Performance: baseline, changes and operations

## Baseline findings (before this change)

Architecture: Next.js 16 App Router (`artifacts/pontreol`) serves pages; FastAPI
(`artifacts/api-server/python`, sync SQLAlchemy + psycopg 3) serves `/api/*`.
Replit's router puts both on one origin. Clerk handles identity; the API
verifies the `__session` JWT itself (JWKS cached for 5 min) and loads the user
row on every request (`deps.current_user`).

Request waterfalls found:

1. **Protected navigation** – middleware `auth()` (local JWT check) → layout
   `auth()` (reads middleware result, cheap) → client hydrates → `RoleGuard`
   rendered a full-page spinner until `/api/me` returned → only then did the
   page mount and start its own requests. Every page paid one extra API round
   trip before fetching its data.
2. **`/api/me` refetches** – 1 min stale time, so most navigations after a minute
   refetched it; failures were retried with backoff.
3. **Home map** – state initialised to New Delhi (28.6139, 77.2090) and
   `useHomeSummary` fired immediately → geolocation resolved → second request
   for the real coordinates. No geolocation timeout (Android Chrome can wait
   indefinitely); a denied permission silently showed Delhi as "your" area.
4. **`/home/summary`** – loaded an arbitrary 100 active listings with no
   geographic filter or ordering, then filtered distance in Python. With more
   than 100 listings, most genuinely nearby listings were never returned.
5. **Retries on 4xx** – React Query retried 401/403/404 three times
   (~7 s of backoff before an error showed).
6. **N+1 queries** – `/providers/{id}` (2 queries per listing), `/conversations`
   (1 query per conversation).
7. **Clerk proxy** – opened a new HTTPS connection to Clerk for every proxied
   request (TLS handshake each time during sign-in).
8. **Sequential client work** – travel origin/destination geocoding, delivery
   pickup/dropoff geocoding and multi-photo uploads ran one after another.
9. **Next 16 params bug** – client pages read `params.id` synchronously. In
   Next 16 production `params` is a Promise, so listing detail, provider,
   request detail, listing edit and availability pages never loaded their data.

## Measurements (local Postgres 16, 20 000 listings around 6 metros)

| Endpoint | Before | After |
|---|---|---|
| `/home/summary` Bengaluru 10 km | 4 queries, 13.7 ms, **2** of 190 nearby listings returned | `view=map`: 2 queries, 11.9 ms, all 190 nearest (47 KB); full view: 4 queries, 29 ms |
| `/listings?lat&lng&sort=distance` | 3 queries, 12.9 ms, results truncated by an arbitrary 500-row scan | 3 queries, 11.2 ms, bounding-box indexed, complete results |
| `/providers/{id}` (~90 listings) | **103 queries**, 220 ms | 5 queries, 14.9 ms |
| `/conversations` (40) | 42 queries, 28 ms | 3 queries, 4.9 ms |
| Bounding-box candidate query | – | index scan on `ix_listings_active_lat_lng`, 1.5 ms |

Client behaviour:

| | Before | After |
|---|---|---|
| Home load (location allowed) | 2 `home/summary` requests (Delhi + real) | 1 request, only after real coordinates |
| Home load (location denied) | 1 request for Delhi shown as "nearby" | 0 requests until the user searches a place |
| First protected page | `/api/me` → wait → page data | `/api/me` and page data in parallel |
| `/api/me` during navigation | refetch whenever older than 1 min | at most once per 5 min (plus on tab refocus when stale) |
| 403/404 error display | after ~7 s of retries | immediately |
| Total client JS (gzip) | 403 KB | 404 KB (unchanged) |

## Operations

### Database pool (per API process)

| Env var | Default | Purpose |
|---|---|---|
| `DB_POOL_SIZE` | 5 | persistent connections |
| `DB_MAX_OVERFLOW` | 5 | burst connections (max 10 total per process) |
| `DB_POOL_TIMEOUT` | 10 s | wait for a free connection before failing |
| `DB_POOL_RECYCLE` | 300 s | replace connections before managed Postgres/PgBouncer idle cut-offs |
| `DB_CONNECT_TIMEOUT` | 10 s | TCP/TLS connect timeout |

`pool_pre_ping` stays on, so stale connections are replaced transparently.
Keep `instances × (DB_POOL_SIZE + DB_MAX_OVERFLOW)` below the database's
connection limit.

### Timing logs

Every API request logs one line (logger `pontreol.timing`):

```
request method=GET path=/api/listings/{listing_id} status=200 duration_ms=23.4 db_queries=5
```

Requests slower than `SLOW_REQUEST_MS` (default 500) log at WARNING with `slow=1`,
so you can find them with `grep slow=1`. Only the route *template* is logged:
no IDs, query strings, cookies, tokens, bodies or payment data. Responses carry
`Server-Timing: app;dur=…`, which shows in browser DevTools. Uvicorn's own
access log is disabled in `start` because it printed raw query strings,
including user coordinates.

### Migration

Apply `artifacts/api-server/migrations/0001_performance_indexes.sql` once per
environment (instructions and rollback are in the file). It is additive,
idempotent, and uses `CREATE INDEX CONCURRENTLY`. The app works without it, but
geo queries fall back to the older single-column indexes.

### PostGIS

PostGIS is not assumed. Geo search uses an indexed latitude/longitude bounding
box plus exact haversine. When volume requires it, the upgrade path is a
`geography(Point,4326)` column with a GiST index queried by `ST_DWithin`,
behind the same `bounding_box` helper.

## Replit vs application latency

- **Cold start (Replit autoscale):** after idle scale-to-zero, the first request
  boots both containers: `uv run` + FastAPI imports, and `next start`. This
  typically adds seconds and is platform latency, not application latency. The
  API log's `duration_ms` excludes it; compare against the browser's total
  time to tell them apart.
- **Per-process warm-up:** the first request after a cold start also pays for
  opening the DB pool, fetching Clerk JWKS, and the first Clerk proxy TLS
  handshake. Later requests reuse all three.
- **Keeping it warm:** a Replit Reserved VM (or any always-on host) removes cold
  starts. That is a hosting choice; no code change is needed.

## Deploying elsewhere (DigitalOcean / Docker / VPS)

No Replit hostnames are hard-coded. Required on any host:

- One public origin with a reverse proxy (nginx/Caddy) that routes `/api/*` to
  uvicorn (`:8080`) and everything else to `next start` (`:21805` or `PORT`).
  It must forward `Host` and `X-Forwarded-Host` / `X-Forwarded-Proto`.
- `ALLOWED_ORIGINS=https://your-domain` (trusted hosts, CORS/CSRF origin checks,
  Clerk `azp`).
- `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and optionally
  `CLERK_PROXY_URL=/api/__clerk` (plus the Clerk dashboard proxy setting).
- Razorpay: `RAZORPAY_MODE` and the matching `RAZORPAY_{TEST|LIVE}_*` secrets;
  point the webhook to `https://your-domain/api/billing/webhook`.
- Object storage: `DEFAULT_OBJECT_STORAGE_BUCKET_ID` and `PRIVATE_OBJECT_DIR`,
  plus Google Cloud credentials (`GOOGLE_APPLICATION_CREDENTIALS`). On Replit
  these are provided implicitly.
- Email: `resend-send.mjs` uses the Replit Connectors SDK. Off Replit it needs a
  Resend API-key transport before notification emails will send.
- `NODE_ENV=production`; run the migration above; build with
  `pnpm --filter @workspace/pontreol run build` and `uv sync --frozen`.
