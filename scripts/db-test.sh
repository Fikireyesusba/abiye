#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL cluster, applies a Supabase emulation layer,
# all migrations, the sample seed, and the SQL test suite. Requires a local
# PostgreSQL (initdb/pg_ctl) install. Usage: npm run test:db
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "PostgreSQL binaries not found (set PGBIN)"; exit 1; }

WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUN_AS=(runuser -u postgres --); fi
cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=("${RUN_AS[@]}" psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres)
"${PSQL[@]}" -d postgres -c "create database app" >/dev/null

run() { echo "  → $(basename "$1")"; "${PSQL[@]}" -d app -f "$1" >/dev/null; }

echo "Supabase emulation"; run "$ROOT/supabase/db-tests/00_supabase_stub.sql"
if [ "${BUNDLE:-0}" = "1" ]; then
  echo "Production bundle";  run "$ROOT/supabase/production-setup.sql"
  echo "Bundle re-run is refused without changes"
  if "${PSQL[@]}" -d app -f "$ROOT/supabase/production-setup.sql" >/dev/null 2>"$WORK/rerun.err"; then echo "FAIL: bundle ran twice"; exit 1; fi
  grep -q "already set up" "$WORK/rerun.err" || { cat "$WORK/rerun.err"; exit 1; }
else
  echo "Migrations";        for f in "$ROOT"/supabase/migrations/*.sql; do run "$f"; done
  echo "Starter (twice: idempotent)"; run "$ROOT/supabase/starter.sql"; run "$ROOT/supabase/starter.sql"
fi
echo "Seed";              run "$ROOT/supabase/seed.sql"
echo "Tests"
for f in "$ROOT"/supabase/db-tests/[1-9]*.sql; do
  echo "  → $(basename "$f")"
  "${PSQL[@]}" -d app -f "$f" 2>&1 | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR):  /\1 /; s/^NOTICE //; s/^/      /'
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "FAILED: $f"; exit 1; }
done
echo "All database tests passed."
