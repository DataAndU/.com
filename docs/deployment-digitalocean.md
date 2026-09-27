# Deploying Pontreol on DigitalOcean

Internet → Cloudflare (proxied, SSL mode **Full (strict)**) → nginx :443 →
Next.js `0.0.0.0:3000` (firewalled) and FastAPI `127.0.0.1:8080` (`/api/*`) →
PostgreSQL (localhost or private network only).

Files: `deploy/digitalocean/` (`nginx-pontreol.conf`, `pontreol-api.service`,
`pontreol-web.service`, `pontreol.env.example`, `gcs-cors.json`).

## 1. One-time server setup (Ubuntu 22.04/24.04)

```bash
sudo adduser --system --group --home /opt/pontreol pontreol
sudo apt-get install -y nginx postgresql-client git
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh
# Node 24 + pnpm 10 (e.g. via NodeSource), then:
sudo corepack enable

# Firewall: only SSH + web. Ports 3000/8080/5432 stay private.
sudo ufw default deny incoming
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable
# PostgreSQL: listen_addresses = 'localhost' (or private VPC IP), never 0.0.0.0.

# Cloudflare origin certificate -> /etc/ssl/cloudflare/pontreol.{pem,key} (chmod 600)
# Cloudflare real-IP snippet:
{ for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"; done; echo "real_ip_header CF-Connecting-IP;"; } \
  | sudo tee /etc/nginx/snippets/cloudflare-realip.conf
```

## 2. Secrets

```bash
sudo mkdir -p /etc/pontreol
sudo cp deploy/digitalocean/pontreol.env.example /etc/pontreol/pontreol.env
sudoedit /etc/pontreol/pontreol.env          # fill real values; never commit
sudo cp <service-account>.json /etc/pontreol/gcs-service-account.json
sudo chown root:pontreol /etc/pontreol/*  && sudo chmod 640 /etc/pontreol/*
```

External configuration:

- **Clerk:** add `https://pontreol.com` as the production domain. If you use
  `CLERK_PROXY_URL=/api/__clerk`, enable the proxy in the Clerk dashboard.
- **Razorpay:** set the webhook to `https://pontreol.com/api/billing/webhook`.
- **GCS:** create the bucket, grant the service account `roles/storage.objectAdmin`,
  and allow browser uploads with
  `gcloud storage buckets update gs://$BUCKET --cors-file=deploy/digitalocean/gcs-cors.json`.
  To keep photos uploaded on Replit, copy the objects with the same keys (the
  database stores the key, which includes `PRIVATE_OBJECT_DIR`), for example
  `gcloud storage rsync -r gs://<replit-bucket>/<dir> gs://$BUCKET/<dir>`, and
  keep `PRIVATE_OBJECT_DIR` identical.
- **Resend:** verify the sender domain, then set `RESEND_API_KEY` and `RESEND_FROM`.

## 3. Deploy / update

```bash
sudo -u pontreol git -C /opt/pontreol fetch origin
sudo -u pontreol git -C /opt/pontreol checkout <release-commit>
cd /opt/pontreol
sudo -u pontreol pnpm install --frozen-lockfile
sudo -u pontreol uv sync --frozen
# NEXT_PUBLIC_* values are inlined at build time: build with the env loaded.
sudo -u pontreol bash -c 'set -a; . /etc/pontreol/pontreol.env; set +a; pnpm --filter @workspace/pontreol run build'

# Database migration (additive, idempotent; see section 4)
sudo -u pontreol bash -c 'set -a; . /etc/pontreol/pontreol.env; set +a; \
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f artifacts/api-server/migrations/0001_performance_indexes.sql'

sudo cp deploy/digitalocean/pontreol-{api,web}.service /etc/systemd/system/
sudo cp deploy/digitalocean/nginx-pontreol.conf /etc/nginx/sites-available/pontreol
sudo ln -sf /etc/nginx/sites-available/pontreol /etc/nginx/sites-enabled/pontreol
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload
sudo systemctl enable --now pontreol-api pontreol-web
sudo systemctl restart pontreol-api pontreol-web

# Verify
curl -fsS https://pontreol.com/healthz        # Next liveness
curl -fsS https://pontreol.com/api/healthz    # API liveness (no dependencies)
curl -fsS https://pontreol.com/api/readyz     # API + PostgreSQL readiness
journalctl -u pontreol-api -f | grep -E "slow=1|WARNING"
```

`psql` needs a `postgresql://` URL. If `DATABASE_URL` uses the
`postgresql+psycopg://` form, pass the plain form instead.

## 4. Migration safety

`0001_performance_indexes.sql` only creates three indexes, using
`CREATE INDEX CONCURRENTLY IF NOT EXISTS`, and runs `ANALYZE`. It never alters
or deletes data, and it does not block writes. It is safe to re-run. If a run
is interrupted, check for an INVALID index as described in the file header.

| Index | Serves |
|---|---|
| `ix_listings_active_lat_lng` (lat, lng) WHERE active | `/home/summary`, `/listings?lat&lng` bounding box |
| `ix_messages_conversation_created` | message history, latest-message previews |
| `ix_notifications_user_created` | notification keyset pagination |

## 5. Rollback

```bash
cd /opt/pontreol
sudo -u pontreol git checkout <previous-release-commit>
sudo -u pontreol pnpm install --frozen-lockfile && sudo -u pontreol uv sync --frozen
sudo -u pontreol bash -c 'set -a; . /etc/pontreol/pontreol.env; set +a; pnpm --filter @workspace/pontreol run build'
sudo systemctl restart pontreol-api pontreol-web
```

The indexes do not need to be removed on rollback because older code ignores
them. To remove them anyway:
`DROP INDEX CONCURRENTLY IF EXISTS ix_listings_active_lat_lng;` and likewise for the other two.

## 6. Failure behaviour

| Dependency down | Effect |
|---|---|
| PostgreSQL | API starts; `/api/healthz` 200, `/api/readyz` 503; data endpoints error; pool reconnects automatically (pre-ping) |
| Clerk | Cached JWKS keeps verifying sessions for ≤5 min; then API returns 503 (not a crash); sign-in UI unavailable |
| GCS | Uploads and `/api/media/*` return 503; photos show a placeholder; everything else works |
| Resend | Emails stay queued with retry (≤10 attempts); nothing else affected |
