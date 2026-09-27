#!/bin/bash
set -e
pnpm install --frozen-lockfile
uv sync --frozen
NODE_ENV=development uv run python artifacts/api-server/python/migrate_dev.py
