# Pontreol web (Next.js) for DigitalOcean App Platform.
# Build context: repository root (pnpm workspace).
FROM node:24-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1 CI=true
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY scripts/package.json ./scripts/package.json
COPY artifacts/pontreol/package.json ./artifacts/pontreol/package.json
RUN pnpm install --frozen-lockfile --filter "@workspace/pontreol..."

COPY artifacts/pontreol ./artifacts/pontreol

# App Platform passes BUILD_TIME / RUN_AND_BUILD_TIME variables as build args.
# The Clerk publishable key is public and must be inlined into browser JS.
ARG CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG CLERK_PROXY_URL
ARG NEXT_PUBLIC_CLERK_PROXY_URL
RUN test -n "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}${CLERK_PUBLISHABLE_KEY}" \
      || (echo "Set CLERK_PUBLISHABLE_KEY (scope: build + run) in App Platform" >&2; exit 1)
RUN NODE_ENV=production pnpm --filter @workspace/pontreol run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
WORKDIR /repo/artifacts/pontreol
EXPOSE 3000
# Binds 0.0.0.0 on App Platform's $PORT (Next/Clerk self-proxy needs a
# non-loopback bind; see docs/deployment-digitalocean.md).
CMD ["sh", "-c", "exec node_modules/.bin/next start --hostname 0.0.0.0 --port ${PORT}"]
