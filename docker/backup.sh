#!/bin/sh
# OpenAnalytics Postgres backup sidecar:
#   loop forever — dump, gzip, prune dumps older than BACKUP_RETENTION_DAYS, sleep 24h.
# Invoked as: sh /backup.sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
: "${PGHOST:=postgres}"
: "${BACKUP_RETENTION_DAYS:=14}"
BACKUP_DIR=/backups

echo "[backup] starting — host=${PGHOST} db=${POSTGRES_DB} retention=${BACKUP_RETENTION_DAYS}d dir=${BACKUP_DIR}"

while true; do
  stamp=$(date +%F)
  out="${BACKUP_DIR}/oa-${stamp}.sql.gz"
  tmp="${out}.tmp"

  echo "[backup] dumping ${POSTGRES_DB} -> ${out}"
  if PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h "${PGHOST}" -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${tmp}"; then
    mv "${tmp}" "${out}"
    echo "[backup] wrote ${out}"
  else
    echo "[backup] pg_dump failed — skipping this run" >&2
    rm -f "${tmp}"
  fi

  echo "[backup] pruning dumps older than ${BACKUP_RETENTION_DAYS}d"
  find "${BACKUP_DIR}" -name 'oa-*.sql.gz' -mtime "+${BACKUP_RETENTION_DAYS}" -delete

  sleep 86400
done
