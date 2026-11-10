#!/usr/bin/env bash
# Applies every migration to a throwaway database on a local Postgres and runs
# the SQL test files in supabase/tests. Never touches a Supabase project.
#   PG_HOST / PG_PORT / PG_USER can override the defaults below.
set -uo pipefail
cd "$(dirname "$0")/.."
HOST="${PG_HOST:-localhost}"; PORT="${PG_PORT:-5432}"; USER_="${PG_USER:-postgres}"
DB="mh_test_$$"
PSQL=(psql -h "$HOST" -p "$PORT" -U "$USER_" -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres -c "create database $DB" >/dev/null || exit 1
trap '"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null' EXIT

for f in supabase/tests/supabase_stub.sql supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null || { echo "✗ migration failed: $f"; exit 1; }
done

fail=0
for t in supabase/tests/*.test.sql; do
  echo "▶ $t"
  out="$("${PSQL[@]}" -d "$DB" -f "$t" 2>&1)"; code=$?
  echo "$out" | sed -n 's/.*NOTICE:  /  ✓ /p; s/.*ERROR:  /  ✗ /p'
  [ $code -eq 0 ] || fail=1
done
[ $fail -eq 0 ] && echo "All database tests passed." || echo "Database tests FAILED."
exit $fail
