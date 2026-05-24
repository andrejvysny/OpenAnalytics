#!/bin/sh
# OpenAnalytics API entrypoint:
#   1. wait for DB
#   2. push schema (idempotent)
#   3. seed model prices (idempotent)
#   4. exec the main CMD
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"

# parse host:port out of DATABASE_URL (postgres://user:pass@host:port/db?…)
# Use distinct names so we don't clobber $PORT meant for the app process.
DB_HOSTPORT=$(echo "$DATABASE_URL" | sed -E 's#.*@([^/]+)/.*#\1#')
DB_HOST=$(echo "$DB_HOSTPORT" | cut -d: -f1)
DB_PORT=$(echo "$DB_HOSTPORT" | cut -sd: -f2)
DB_PORT=${DB_PORT:-5432}

echo "[entrypoint] waiting for postgres at ${DB_HOST}:${DB_PORT}…"
i=0
while ! nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[entrypoint] postgres not reachable after 60s — aborting" >&2
    exit 1
  fi
  sleep 1
done
echo "[entrypoint] postgres reachable"

if [ "${OA_SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "[entrypoint] pushing drizzle schema…"
  cd /app/packages/db && pnpm exec drizzle-kit push --force || {
    echo "[entrypoint] schema push failed" >&2; exit 1; }
  cd /app
fi

if [ "${OA_SKIP_SEED:-0}" != "1" ]; then
  echo "[entrypoint] seeding model prices…"
  bun /app/apps/api/scripts/seed-prices.ts || echo "[entrypoint] seed-prices warning (continuing)"
fi

echo "[entrypoint] starting api: $*"
exec "$@"
