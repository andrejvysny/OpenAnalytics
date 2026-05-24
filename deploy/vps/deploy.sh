#!/usr/bin/env bash
# OpenAnalytics — one-shot VPS deploy.
# Usage: ./deploy/vps/deploy.sh [ssh-host]
#
# Requires: rsync, ssh, the VPS already has docker + compose, and an A/AAAA
# record for $OA_DOMAIN pointing at the VPS. Traefik in /opt/traefik/ is
# expected (or this script will start it if it finds a compose file there).

set -euo pipefail

SSH_HOST="${1:-vps}"
OA_DOMAIN="${OA_DOMAIN:-openanalytics.andrejvysny.sk}"
ADMIN_EMAIL="${ADMIN_EMAIL:-vysnyandrej@gmail.com}"
ADMIN_NAME="${ADMIN_NAME:-Andrej Vyšný}"
REMOTE_DIR="/opt/openanalytics"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
log() { printf "  → %s\n" "$*"; }

bold "OpenAnalytics deploy to ${SSH_HOST} (${OA_DOMAIN})"

# ---- 1. sanity checks ---------------------------------------------------------
command -v rsync >/dev/null || { echo "rsync not installed"; exit 1; }
command -v ssh   >/dev/null || { echo "ssh not installed"; exit 1; }

bold "1. rsync source to ${SSH_HOST}:${REMOTE_DIR}/src/"
ssh "$SSH_HOST" "mkdir -p ${REMOTE_DIR}/src"
rsync -az --delete \
  --exclude=node_modules --exclude=.next --exclude=dist \
  --exclude=.git --exclude=screenshots --exclude=.playwright-cli \
  --exclude=vibenal --exclude=vibenalytics \
  --exclude='.env' --exclude='.env.local' \
  --exclude='oa-darwin-*' --exclude='oa-linux-*' --exclude='oa-windows-*' \
  "${REPO_DIR}/" "${SSH_HOST}:${REMOTE_DIR}/src/"
log "sync complete"

# ---- 2. ensure .env exists -- external Postgres required --------------------
bold "2. ensure /opt/openanalytics/.env (creates skeleton on first run)"
ssh "$SSH_HOST" \
  "OA_DOMAIN='${OA_DOMAIN}' \
   DATABASE_URL_ARG='${DATABASE_URL:-}' \
   SMTP_HOST_ARG='${SMTP_HOST:-}' \
   SMTP_PORT_ARG='${SMTP_PORT:-}' \
   SMTP_USER_ARG='${SMTP_USER:-}' \
   SMTP_PASSWORD_ARG='${SMTP_PASSWORD:-}' \
   EMAIL_FROM_ARG='${EMAIL_FROM:-}' \
   bash -s" <<'REMOTE'
set -euo pipefail
ENV_FILE=/opt/openanalytics/.env
if [ ! -f "$ENV_FILE" ]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
OA_DOMAIN=${OA_DOMAIN}
TRAEFIK_CERT_RESOLVER=letsencrypt
SESSION_SECRET=${SESSION_SECRET}
# External Postgres connection string. Required.
DATABASE_URL=${DATABASE_URL_ARG:-postgres://USER:PASSWORD@HOST:5432/DB}
EOF
  chmod 600 "$ENV_FILE"
  echo "  generated $ENV_FILE"
  if [ -z "${DATABASE_URL_ARG}" ]; then
    echo
    echo "  ⚠  DATABASE_URL placeholder written. Edit /opt/openanalytics/.env with your"
    echo "     real Postgres connection string, then re-run deploy.sh."
    exit 2
  fi
else
  echo "  keeping existing $ENV_FILE"
fi
# Strip any legacy POSTGRES_* lines from a previous bundled-db setup.
sed -i '/^POSTGRES_/d' "$ENV_FILE"
# Set DATABASE_URL: replace if present, append if missing. Use a Python helper so
# percent-encoded and shell-special chars in the URL aren't mangled by sed.
set_env_var() {
  local file="$1" key="$2" val="$3"
  [ -z "$val" ] && return 0
  python3 - "$file" "$key" "$val" <<'PY'
import sys, pathlib
path, key, new = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
lines = p.read_text().splitlines()
found = False
out = []
for line in lines:
    if line.startswith(f'{key}='):
        out.append(f'{key}={new}')
        found = True
    else:
        out.append(line)
if not found:
    out.append(f'{key}={new}')
p.write_text('\n'.join(out) + '\n')
PY
}

set_env_var "$ENV_FILE" DATABASE_URL "${DATABASE_URL_ARG}"
set_env_var "$ENV_FILE" SMTP_HOST "${SMTP_HOST_ARG}"
set_env_var "$ENV_FILE" SMTP_PORT "${SMTP_PORT_ARG}"
set_env_var "$ENV_FILE" SMTP_USER "${SMTP_USER_ARG}"
set_env_var "$ENV_FILE" SMTP_PASSWORD "${SMTP_PASSWORD_ARG}"
set_env_var "$ENV_FILE" EMAIL_FROM "${EMAIL_FROM_ARG}"
[ -n "${DATABASE_URL_ARG}" ] && echo "  set DATABASE_URL"
[ -n "${SMTP_HOST_ARG}" ] && echo "  set SMTP_*"
# Sanity-check the connection string is not still the placeholder.
if grep -q '^DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB' "$ENV_FILE"; then
  echo "  ⚠  DATABASE_URL is still the placeholder. Edit $ENV_FILE then re-run."
  exit 2
fi
# Symlink so `docker compose` finds it next to compose.yml.
ln -sf "$ENV_FILE" /opt/openanalytics/src/deploy/vps/.env
REMOTE

# ---- 3. ensure traefik + proxy network are up --------------------------------
bold "3. ensure proxy network + Traefik are running"
ssh "$SSH_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
docker network inspect proxy >/dev/null 2>&1 || {
  echo "  creating docker network: proxy"
  docker network create proxy
}
if [ -f /opt/traefik/docker-compose.yml ] || [ -f /opt/traefik/compose.yml ]; then
  if ! docker ps --format '{{.Names}}' | grep -q '^traefik-proxy$'; then
    echo "  starting traefik"
    (cd /opt/traefik && docker compose up -d)
  else
    echo "  traefik already running"
  fi
else
  echo "  WARNING: /opt/traefik not found — assuming proxy is reachable elsewhere"
fi
REMOTE

# ---- 4. build + bring up the stack -------------------------------------------
bold "4. build & start OpenAnalytics stack (this builds images on VPS — first run ~3 min)"
ssh "$SSH_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/openanalytics/src/deploy/vps
docker compose build --pull
docker compose up -d
REMOTE

# ---- 5. wait for api health --------------------------------------------------
bold "5. wait for api healthy"
ssh "$SSH_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
for i in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' oa-api 2>/dev/null || echo missing)
  [ "$s" = "healthy" ] && { echo "  api healthy after ${i}s"; exit 0; }
  sleep 2
done
echo "  api never became healthy. Logs:" >&2
docker logs --tail 80 oa-api >&2 || true
exit 1
REMOTE

# ---- 6. create admin + first API key -----------------------------------------
bold "6. create admin user + first API key"
ssh "$SSH_HOST" "ADMIN_EMAIL='${ADMIN_EMAIL}' ADMIN_NAME='${ADMIN_NAME}' bash -s" <<'REMOTE'
set -euo pipefail
CREDS=/opt/openanalytics/CREDS.txt
# Skip if creds file already populated (rerun-safe).
if [ -f "$CREDS" ] && grep -q '^api_key=' "$CREDS"; then
  echo "  CREDS.txt already exists — skipping admin bootstrap"
  exit 0
fi
PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
# dev-bootstrap.ts creates/updates user + ALWAYS appends a fresh api key.
OUT=$(docker exec oa-api bun apps/api/scripts/dev-bootstrap.ts "$ADMIN_EMAIL" "$PASSWORD" "$ADMIN_NAME")
API_KEY=$(echo "$OUT" | awk -F': *' '/^apiKey:/{print $2}' | tr -d ' ')
USER_ID=$(echo "$OUT" | awk -F': *' '/^userId:/{print $2}' | tr -d ' ')
umask 077
cat > "$CREDS" <<EOF
# OpenAnalytics — initial credentials (keep secret)
# Generated $(date -u +%FT%TZ) by deploy.sh
dashboard_url=https://${OA_DOMAIN:-openanalytics.andrejvysny.sk}
email=${ADMIN_EMAIL}
password=${PASSWORD}
user_id=${USER_ID}
api_key=${API_KEY}
EOF
chmod 600 "$CREDS"
echo "  wrote $CREDS (mode 600)"
REMOTE

# ---- 7. print summary --------------------------------------------------------
bold "7. verify + print summary"
ssh "$SSH_HOST" 'bash -s' <<REMOTE
echo
echo "=== container status ==="
docker compose -f /opt/openanalytics/src/deploy/vps/compose.yml ps
echo
echo "=== CREDS.txt ==="
cat /opt/openanalytics/CREDS.txt
echo
echo "=== external health (HTTPS via Traefik) ==="
curl -sf https://${OA_DOMAIN}/health && echo
echo
echo "Dashboard:  https://${OA_DOMAIN}/login"
echo "CLI setup:  oa login --api-url https://${OA_DOMAIN} --api-key <see CREDS.txt above>"
REMOTE

bold "✓ deploy complete"
