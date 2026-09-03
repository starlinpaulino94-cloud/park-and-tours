#!/usr/bin/env bash
# ============================================================================
# Prueba de RPC/SQL contra un Postgres efímero.
#
# Levanta un cluster temporal, aplica el stub de objetos de Supabase
# (supabase/tests/00_supabase_stub.sql), todas las migraciones
# (supabase/migrations/0*.sql en orden) y cada prueba supabase/tests/*.test.sql.
#
# Requisitos: postgres 16 (initdb/pg_ctl/psql). No toca ninguna base remota.
# Uso:  bash scripts/db-test.sh
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
[ -n "${PGBIN:-}" ] && export PATH="$PGBIN:$PATH"
command -v initdb >/dev/null || { echo "initdb no encontrado; instala postgresql-16 o exporta PGBIN"; exit 1; }

WORK="$(mktemp -d)"
export PGDATA="$WORK/data" PGHOST="$WORK/sock" PGPORT="${PGPORT:-54329}"
mkdir -p "$PGHOST"
cleanup() { pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

# Postgres no corre como root: si somos root, delegamos en el usuario postgres.
RUN=(); if [ "$(id -u)" = "0" ]; then RUN=(runuser -u postgres --); chown -R postgres:postgres "$WORK"; fi

"${RUN[@]}" initdb -D "$PGDATA" -A trust >/dev/null
"${RUN[@]}" pg_ctl -D "$PGDATA" -o "-p $PGPORT -k $PGHOST -c listen_addresses=''" -w start >/dev/null
"${RUN[@]}" createdb -h "$PGHOST" -p "$PGPORT" appdb

psql_run() { "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d appdb -v ON_ERROR_STOP=1 -q "$@"; }

echo "→ stub de Supabase"
psql_run -f "$ROOT/supabase/tests/00_supabase_stub.sql"

echo "→ migraciones"
for f in "$ROOT"/supabase/migrations/0*.sql; do
  psql_run -f "$f"
done

echo "→ pruebas"
fail=0
for t in "$ROOT"/supabase/tests/*.test.sql; do
  [ -e "$t" ] || continue
  echo "  · $(basename "$t")"
  if ! "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d appdb -v ON_ERROR_STOP=1 -f "$t"; then
    fail=1
  fi
done

[ "$fail" = "0" ] && echo "✔ pruebas de base de datos en verde" || { echo "✘ fallaron pruebas de base de datos"; exit 1; }
