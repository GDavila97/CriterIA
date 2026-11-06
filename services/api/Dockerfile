# syntax=docker/dockerfile:1

# Must match [tool.uv] required-version in pyproject.toml; uv sync refuses to run otherwise.
FROM ghcr.io/astral-sh/uv:0.13.7 AS uv

FROM python:3.13-slim-trixie AS builder
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

FROM python:3.13-slim-trixie AS runtime
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --chown=app:app prompts ./prompts
COPY --chown=app:app config ./config
# The same image runs the migrations as a one-off job: alembic upgrade head.
COPY --chown=app:app alembic.ini ./
COPY --chown=app:app migrations ./migrations
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    PROMPTS_DIR=/app/prompts \
    MODELS_FILE=/app/config/models.toml
USER app
EXPOSE 8080
# Cloud Run ignores HEALTHCHECK; it serves local runs and other orchestrators.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['PORT']}/healthz\", timeout=2)"]
CMD ["criteria-api"]
