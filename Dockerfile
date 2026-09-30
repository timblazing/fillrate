# One image: Next.js standalone server (Node 24) + Python 3.13 optimizer and worker supervisor.
# Only port 3000 is exposed; the worker transport (3100) and FastAPI (8000) bind to 127.0.0.1.
FROM oven/bun:1.4.2 AS bun
FROM ghcr.io/astral-sh/uv:0.8.2 AS uv

FROM node:24-bookworm-slim AS web
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN bun install --frozen-lockfile && bun run build

# Managed CPython 3.13 at a fixed path so the venv's interpreter link survives the copy.
FROM debian:bookworm-slim AS python
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_PROJECT_ENVIRONMENT=/opt/venv UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_PREFERENCE=only-managed
WORKDIR /src
COPY services/optimizer/pyproject.toml services/optimizer/uv.lock services/optimizer/.python-version ./
RUN uv python install 3.13 && uv sync --locked --no-dev --no-install-project
COPY services/optimizer/ ./
RUN uv sync --locked --no-dev --no-editable

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data \
    DB_MIGRATIONS_DIR=/app/packages/db/migrations \
    INTERNAL_PORT=3100 \
    FILLRATE_INTERNAL_URL=http://127.0.0.1:3100 \
    OPTIMIZER_PORT=8000
COPY --from=python /opt/python /opt/python
COPY --from=python /opt/venv /opt/venv
COPY --from=web --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=web --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=web /repo/packages/db/migrations ./packages/db/migrations
COPY deploy/entrypoint.sh /usr/local/bin/fillrate-entrypoint
RUN mkdir -p /app/data && chown node:node /app/data && /opt/venv/bin/python -c "import pyvrp, sklearn, ortools"
USER node
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/fillrate-entrypoint"]
