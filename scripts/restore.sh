#!/usr/bin/env bash
# Restores a backup into an EMPTY database, then runs integrity checks.
# Usage: scripts/restore.sh <backup.dump> <target-database-url>
# Never point the target at the live production database.
set -euo pipefail
FILE="${1:?backup file required}"
TARGET="${2:?target database URL required}"
if [ -f "$FILE.sha256" ]; then sha256sum -c "$FILE.sha256"; fi
COUNT=$(psql "$TARGET" -tAc "select count(*) from information_schema.tables where table_schema='public'")
if [ "$COUNT" != "0" ]; then echo "Target database is not empty ($COUNT tables). Aborting." >&2; exit 1; fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET" "$FILE"
echo "Restored. Running integrity checks…"
psql "$TARGET" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/verify-restore.sql"
