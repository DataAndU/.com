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

The API health check (`/api/healthz`) doesn't depend on PostgreSQL, Clerk,
storage or email. An outage in one of them returns errors only for the
affected features, and doesn't cause restart loops. `/api/readyz` reports
database reachability for monitoring.

## Rollback

App → **Activity** → pick the previous successful deployment → **Rollback**.
The migration's indexes can stay in place; older code ignores them.
