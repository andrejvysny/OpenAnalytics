# syntax=docker/dockerfile:1.7
# OpenAnalytics API — Hono on Bun + Drizzle migrations.

FROM oven/bun:1.3-alpine AS base
WORKDIR /app
RUN apk add --no-cache nodejs npm tini wget netcat-openbsd \
    && npm i -g pnpm@10

# ---- deps: copy only manifests so dep install caches across source changes ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/schema/package.json packages/schema/package.json
RUN pnpm install --filter @oa/api... --frozen-lockfile=false

# ---- build: copy source & typecheck ----
FROM deps AS build
COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/schema packages/schema
RUN pnpm --filter @oa/api typecheck

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3001
COPY --from=build /app /app
COPY docker/api-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && \
    addgroup -S oa && adduser -S -G oa oa && \
    chown -R oa:oa /app
USER oa
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["bun", "apps/api/src/index.ts"]
