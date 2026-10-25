#!/usr/bin/env bash
# Creates a compressed, point-in-time backup of the database named in DATABASE_URL.
# Usage: scripts/backup.sh [output-dir]      (default: ./backups)
# Requires the PostgreSQL client tools (pg_dump) matching the server major version.
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
: "${DATABASE_URL:?DATABASE_URL is not set}"
OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"
STAMP="$(TZ=Asia/Dubai date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/edge-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"
sha256sum "$FILE" > "$FILE.sha256"
echo "Backup written: $FILE"
echo "Phase 1 stores no uploaded files. When attachments are added, back up the object storage bucket alongside this file."
