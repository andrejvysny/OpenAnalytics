# syntax=docker/dockerfile:1.7
# Production Web image — Next.js 15 standalone output.

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache tini wget && npm i -g pnpm@10

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @oa/web... --frozen-lockfile=false

# ---- build ----
FROM deps AS build
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NODE_ENV=production
WORKDIR /app/apps/web
RUN pnpm exec next build

# ---- runtime (standalone) ----
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini wget && addgroup -S oa && adduser -S oa -G oa
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=oa:oa /app/apps/web/.next/standalone /app
COPY --from=build --chown=oa:oa /app/apps/web/.next/static /app/apps/web/.next/static
USER oa
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
