# Deploying Pontreol on DigitalOcean App Platform

Spec: `.do/app.yaml`. Dockerfiles: `deploy/digitalocean-app-platform/`.
(`deploy/digitalocean/` is the separate Droplet/nginx option and is not used here.)

| Component | Type | Build | Run | Route | Health check |
|---|---|---|---|---|---|
| `web` | Service (Dockerfile) | `web.Dockerfile`: `pnpm install --frozen-lockfile` + `pnpm --filter @workspace/pontreol run build` | `next start --hostname 0.0.0.0 --port $PORT` | `/` | `/healthz` |
| `api` | Service (Dockerfile) | `api.Dockerfile`: Python 3.13 + `uv sync --frozen` | `uvicorn app:app --host 0.0.0.0 --port $PORT` | `/api` (prefix preserved) | `/api/healthz` |

Both builds use the repository root as build context. The Python version
comes from `.python-version` (3.13), and the API image refuses to build if its
interpreter doesn't match that file.

## Why the original error happened

DigitalOcean's Python buildpack requires `pyproject.toml`, `uv.lock` **and**
`.python-version` when uv is used. The repository had no `.python-version`,
which produced
"python version required when uv package manager is used". It is now pinned
to `3.13`, which matches `requires-python = ">=3.13"`, the lockfile, and App
Platform's supported 3.13.x runtimes. The spec also builds with Dockerfiles,
because the repository root holds both a Node workspace and the Python
project, and buildpack autodetection cannot split them into two services.

## Database migration (manual, once)

Nothing runs at startup. After the first successful deploy:
App → **Console** tab → component **api** → run

```
python python/apply_migrations.py
```

It only creates three indexes (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`) and
runs `ANALYZE`. It refuses any file containing DROP/TRUNCATE/DELETE/ALTER/UPDATE,
detects interrupted builds, and is safe to run again.

## Google Cloud Storage on App Platform

App Platform has no persistent disk for a key file. Paste the service-account
JSON key (whole file, or its base64) into the secret
`GOOGLE_APPLICATION_CREDENTIALS_JSON`. The bucket stays private. Photos are
still served through `/api/media/{id}` with short-lived signed URLs. Apply
the upload CORS rule once:
`gcloud storage buckets update gs://BUCKET --cors-file=deploy/digitalocean/gcs-cors.json`.

## Failure behaviour

The API health check (`/api/healthz`) doesn't depend on PostgreSQL, Google,
storage or email. An outage in one of them returns errors only for the
affected features, and doesn't cause restart loops. `/api/readyz` reports
database reachability for monitoring.

## Rollback

App → **Activity** → pick the previous successful deployment → **Rollback**.
The migration's indexes can stay in place; older code ignores them.

## Environment variables (authoritative, from the code)

| Variable | web | api | Secret | Notes |
|---|---|---|---|---|
| `NODE_ENV=production` | ✓ | ✓ | no | fixed in spec |
| `ALLOWED_ORIGINS` | ✓ | ✓ | no | `https://pontreol.com` (+ app URL); trusted host, CORS/CSRF, Google callback URL |
| `GOOGLE_CLIENT_ID` | | ✓ | no | Google OAuth Web client ID (`…apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | | ✓ | **yes** | Google OAuth client secret; never given to Next.js |
| `DATABASE_URL` | | ✓ | **yes** | DigitalOcean **direct** connection string (port 25060, `sslmode=require`), not a PgBouncer pool |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT`, `DB_POOL_RECYCLE`, `DB_CONNECT_TIMEOUT` | | ✓ | no | fixed defaults in spec |
| `RAZORPAY_MODE=live` | | ✓ | no | fixed |
| `RAZORPAY_LIVE_KEY_ID` | | ✓ | no | must start `rzp_live_` |
| `RAZORPAY_LIVE_KEY_SECRET` | | ✓ | **yes** | |
| `RAZORPAY_LIVE_WEBHOOK_SECRET` | | ✓ | **yes** | webhook URL `https://pontreol.com/api/billing/webhook`, subscription events |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | | ✓ | **yes** | entire service-account JSON key (or base64 of it) |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | | ✓ | no | bucket name |
| `PRIVATE_OBJECT_DIR` | | ✓ | no | `private` (keep the Replit value if copying old photos) |
| `RESEND_API_KEY` | | ✓ | **yes** | `re_…`, "Sending access" is enough |
| `RESEND_FROM` | | ✓ | no | `Pontreol <notifications@pontreol.com>`; domain must be verified in Resend |
| `NOMINATIM_USER_AGENT`, `LOG_LEVEL`, `SLOW_REQUEST_MS` | | ✓ | no | fixed |

Not needed: any `CLERK_*` variable (Clerk was removed; see docs/authentication.md),
`GOOGLE_REDIRECT_URI` (defaults to `https://pontreol.com/api/auth/google/callback`),
`GOOGLE_APPLICATION_CREDENTIALS` (file path; Droplet only), `REPLIT_*`, and
`RAZORPAY_TEST_*` (live mode ignores them).

### Database: copy, don't start empty

Production never creates tables at startup, so a brand-new database has no
schema. Copy the existing (Replit) database into DigitalOcean Managed
PostgreSQL once. The copy is read-only on the source:

```
pg_dump "$OLD_DATABASE_URL" --format=custom --no-owner --no-privileges -f pontreol.dump
pg_restore --no-owner --no-privileges --dbname "$NEW_DATABASE_URL" pontreol.dump
```

Then run `python python/apply_migrations.py` from the api Console.
