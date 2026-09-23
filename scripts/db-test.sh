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

# UTF-8 EXPLÍCITO, y no el que salga del entorno.
#
# Sin esto, `initdb` hereda la configuración regional del contenedor —que suele
# ser C— y crea la base en SQL_ASCII. En SQL_ASCII, Postgres trata cada carácter
# multibyte como bytes sueltos: `translate('José', 'é', 'e')` devuelve basura, y
# la columna de búsqueda normalizada de 0062 dejaría de encontrar acentos.
#
# Producción es UTF-8. Una prueba que corre con otra codificación comprueba otra
# base, y justo el día que importa dice que todo está bien.
"${RUN[@]}" initdb -D "$PGDATA" -A trust --encoding=UTF8 --no-locale >/dev/null
"${RUN[@]}" pg_ctl -D "$PGDATA" -o "-p $PGPORT -k $PGHOST -c listen_addresses=''" -w start >/dev/null
"${RUN[@]}" createdb -h "$PGHOST" -p "$PGPORT" -E UTF8 appdb

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

# ── El sembrador de demostración, ejecutado DOS VECES ───────────────────────
# Es lo que se pega en el editor de Supabase para cargar una empresa demo
# completa. Se ejecuta contra el esquema real por dos razones: que no envejezca
# cuando una migración cambie una tabla, y —corriéndolo dos veces— que sea de
# verdad idempotente, que es lo que promete. Si dejara restos, la segunda pasada
# chocaría contra una clave única y el CI se pondría rojo.
for seed in "$ROOT"/supabase/seed/demo_presentation.sql; do
  [ -e "$seed" ] || { echo "✘ falta $seed"; fail=1; continue; }
  echo "→ sembrador de demostración (1ª pasada)"
  if ! psql_run -f "$seed" >/dev/null; then echo "✘ el sembrador no corre contra el esquema actual"; fail=1; continue; fi
  echo "→ sembrador de demostración (2ª pasada — idempotencia)"
  if ! psql_run -f "$seed" >/dev/null; then echo "✘ el sembrador no es idempotente: la 2ª pasada falló"; fail=1; fi
done

# Y la versión en tres partes, ejecutada EN ORDEN (es la que se usa cuando el
# editor de Supabase trunca el pegado grande). Debe dejar el mismo resultado.
# Y los trozos pequeños (los que se pegan sin que el editor los trunque), en orden.
for pf in "$ROOT"/supabase/seed/demo_partes/demo_*.sql; do
  [ -e "$pf" ] || continue
  echo "→ sembrador de demostración por trozos: $(basename "$pf")"
  if ! psql_run -f "$pf" >/dev/null; then echo "✘ el trozo $(basename "$pf") no corre"; fail=1; fi
done

# ── Los cuadernos de SQL, ejecutados ────────────────────────────────────────
# Lo que se le entrega a alguien para que lo pegue en el editor de Supabase se
# ejecuta aquí primero. Los correos y slugs de los ejemplos no existen, así que
# las escrituras tocan cero filas: lo que se comprueba es que TODOS los bloques
# analizan y encajan con el esquema de verdad. Documentación que nadie ejecuta
# envejece en silencio, y esta se usa el peor día contra producción.
for doc in "$ROOT"/docs/operaciones/DESDE_EL_EDITOR_SQL.md; do
  [ -e "$doc" ] || { echo "✘ falta $doc"; fail=1; continue; }
  echo "→ bloques SQL de $(basename "$doc")"
  extraido="$WORK/$(basename "$doc").sql"
  if ! node "$ROOT/scripts/extract-doc-sql.mjs" "$doc" > "$extraido"; then fail=1; continue; fi
  [ "$(id -u)" = "0" ] && chown postgres "$extraido"
  if ! psql_run -f "$extraido" >/dev/null; then
    echo "✘ un bloque del cuaderno no corre contra el esquema actual"; fail=1
  fi
done

[ "$fail" = "0" ] && echo "✔ pruebas de base de datos en verde" || { echo "✘ fallaron pruebas de base de datos"; exit 1; }
