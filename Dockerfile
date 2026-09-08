# Satu image: API (Bun + Hono) + dashboard statis. Stateless: data di Postgres (DATABASE_URL), analitik DuckDB in-memory.
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/analytics/package.json packages/analytics/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run --cwd apps/dashboard build

FROM oven/bun:1.3 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
# dashboard/package.json wajib ikut: bun.lock mencakup semua workspace, tanpa ini --frozen-lockfile gagal
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/analytics/package.json packages/analytics/
RUN bun install --frozen-lockfile --production
COPY apps/api apps/api
COPY packages packages
COPY --from=build /app/apps/dashboard/dist /app/apps/dashboard/dist
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
# Ekstensi `postgres` DuckDB di-INSTALL SAAT BUILD ke folder di image. Pod tidak mengunduh apa pun saat start
# (tanpa ini: start bergantung internet + extensions.duckdb.org, dan tiap replica mengunduh sendiri).
ENV DUCKDB_EXTENSION_DIR=/app/.duckdb/extensions
RUN mkdir -p /app/.duckdb/extensions && bun run packages/analytics/scripts/install-ext.ts && chown -R bun:bun /app/.duckdb
ENV PORT=3000 STATIC_DIR=/app/apps/dashboard/dist
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://localhost:3000/health || exit 1
CMD ["bun", "run", "apps/api/src/index.ts"]
