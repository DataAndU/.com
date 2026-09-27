# Pontreol

Location-based availability marketplace connecting buyers and providers. Marketplace transactions happen offline; only platform subscriptions use Razorpay.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the FastAPI server
- `pnpm --filter @workspace/pontreol run dev` — run Next.js
- `NODE_ENV=development uv run python artifacts/api-server/python/migrate_dev.py` — create missing development tables; never a production migration
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: Next.js App Router, TypeScript, Tailwind CSS
- API: Python FastAPI
- DB: PostgreSQL + SQLAlchemy; legacy Drizzle scaffolding is not the marketplace schema
- Validation: Pydantic on the API; Clerk verifies identity, database roles enforce permissions
- API contracts: `docs/api-contract.md`, `docs/billing-contract.md`, FastAPI OpenAPI

## Where things live

- `artifacts/pontreol/app` — Next.js pages and theme
- `artifacts/api-server/python` — API, SQLAlchemy models, explicit development schema setup
- `artifacts/api-server/resend-send.mjs` — private Resend connector transport for the email outbox

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## Product constraints

- Requested stack: Next.js, TypeScript, Tailwind CSS, Python FastAPI, PostgreSQL.
- Preserve the navy-to-teal interlocking-diamond logo and minimal dark theme.
- Require Google sign-in for browsing. Buyer/provider role is permanent; administrator permission is separate.
- Build and verify category bookings in this order: Services, Spaces, Equipment, Delivery, Travel.
- Razorpay defaults to test mode. The owner has authorized preparing live platform subscriptions; activate production live mode only after secure live credentials, signed webhooks, and a successful publish are verified. Keep test and live records isolated. Never automate a real payment; any real-charge check must be personally approved and completed by the owner. Buyer-provider transactions remain offline.
- Use free/open mapping and geocoding with attribution and provider usage limits.
- Resend is the chosen notification email provider. Never log notification contents, tokens, credentials, or private ID images.
- Explain progress and manual verification steps in plain language, and distinguish working features from credential-dependent setup.

## Gotchas

- The shared preview proxy routes `/api` to FastAPI; browser fetches must stay same-origin. Do not add a hardcoded localhost rewrite to Next.js.
- Python packages are managed by the root `pyproject.toml` / `uv.lock`; run through `uv run`.
- Production schema changes require an explicit migration. Application startup must not create tables.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
