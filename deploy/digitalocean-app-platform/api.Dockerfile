# Pontreol API (FastAPI) for DigitalOcean App Platform.
# Build context: repository root. Python version comes from .python-version (3.13).
FROM python:3.13-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    NODE_ENV=production

WORKDIR /app

# Dependencies first (cached layer), exactly as locked in uv.lock.
COPY pyproject.toml uv.lock .python-version ./
RUN test "$(python -c 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")')" = "$(cat .python-version)" \
 && uv sync --frozen --no-install-project

COPY artifacts/api-server/python ./artifacts/api-server/python
COPY artifacts/api-server/migrations ./artifacts/api-server/migrations

RUN useradd --system --uid 10001 pontreol && chown -R pontreol /app/artifacts
USER pontreol

WORKDIR /app/artifacts/api-server
ENV PATH="/app/.venv/bin:$PATH" PORT=8080
EXPOSE 8080

# App Platform injects $PORT. No migrations or table creation at startup.
CMD ["sh", "-c", "exec uvicorn app:app --app-dir python --host 0.0.0.0 --port ${PORT} --no-access-log --timeout-keep-alive 30"]
