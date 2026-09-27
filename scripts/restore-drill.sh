#!/usr/bin/env bash
# ============================================================================
# SIMULACRO DE RESTAURACIÓN (DR-001).
#
# ─────────────────────────────────────────────────────────────────────────────
# QUÉ ERA DR-001
#
# «Supabase hace copias; que se pueda volver de una no lo ha verificado nadie.»
# Y la parte cara no es si el volcado se puede restaurar —eso casi siempre
# funciona— sino si lo que queda DESPUÉS sirve. En este sistema una base
# restaurada a medias no da un solo error: arranca, atiende, y devuelve cero
# filas a todo el mundo, porque todas las políticas comparan contra
# `app.current_org_id()`. Vacío y silencioso.
#
# ─────────────────────────────────────────────────────────────────────────────
# QUÉ HACE ESTE SIMULACRO, Y QUÉ NO
#
# HACE: monta una base con el esquema real y datos, la vuelca, **la destruye**,
# la restaura y comprueba que lo que queda sirve — con el mismo script que se
# pega en el editor después de una restauración de verdad
# (`supabase/verify/restauracion.sql`). Así el script de comprobación no es un
# documento: es algo que corre en cada CI.
#
# Y después hace lo que casi nunca se hace: ROMPE la base restaurada a
# propósito, tres veces, y exige que la comprobación lo CACE. Una verificación
# que no puede fallar no verifica nada, y esa es exactamente la forma en que un
# plan de recuperación se pudre sin que nadie lo note.
#
# NO HACE: probar las copias de Supabase. Esto prueba el PROCEDIMIENTO y la
# COMPROBACIÓN. Lo que hay que hacer una vez contra el proyecto de verdad está
# en `docs/runbooks/RESTAURACION.md`, y son treinta minutos.
#
# Uso:  bash scripts/restore-drill.sh
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
[ -n "${PGBIN:-}" ] && export PATH="$PGBIN:$PATH"
command -v initdb >/dev/null || { echo "initdb no encontrado; instala postgresql-16 o exporta PGBIN"; exit 1; }

WORK="$(mktemp -d)"
export PGDATA="$WORK/data" PGHOST="$WORK/sock" PGPORT="${PGPORT:-54331}"
mkdir -p "$PGHOST"
cleanup() { pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

RUN=(); if [ "$(id -u)" = "0" ]; then RUN=(runuser -u postgres --); chown -R postgres:postgres "$WORK"; fi

"${RUN[@]}" initdb -D "$PGDATA" -A trust --encoding=UTF8 --no-locale >/dev/null
"${RUN[@]}" pg_ctl -D "$PGDATA" -o "-p $PGPORT -k $PGHOST -c listen_addresses=''" -w start >/dev/null

en() { "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d "$1" -v ON_ERROR_STOP=1 -q "${@:2}"; }
sin_eco() { "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d "$1" -tAX "${@:2}"; }

# ── 1. La base «de producción» del simulacro ───────────────────────────────
echo "→ 1/6  montando la base con el esquema real y datos"
"${RUN[@]}" createdb -h "$PGHOST" -p "$PGPORT" -E UTF8 origen
en origen -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/0*.sql; do en origen -f "$f" >/dev/null; done
en origen -f "$ROOT/supabase/seed/demo_presentation.sql" >/dev/null

# Una cuenta y su membresía: es lo que hace que la fila 9 de la comprobación
# —«membresías sin cuenta»— tenga algo que mirar. Sin cuentas, esa comprobación
# pasa por no tener nada que comprobar, que es la peor forma de pasar.
en origen -c "
  insert into auth.users (id, email) values
    ('dd000000-0000-4000-8000-000000000001', 'simulacro@restauracion.invalid')
    on conflict do nothing;
  insert into organization_memberships (user_id, organization_id, role, status, is_primary)
    select 'dd000000-0000-4000-8000-000000000001', o.id, 'owner', 'active', true
      from organizations o where o.kind = 'tenant' limit 1
    on conflict do nothing;
" >/dev/null

EMPRESAS="$(sin_eco origen -c 'select count(*) from organizations')"
VENTAS="$(sin_eco origen -c 'select count(*) from sales_order')"
echo "     $EMPRESAS empresas, $VENTAS ventas"
[ "$EMPRESAS" -gt 0 ] || { echo "✘ el simulacro arrancó sin datos: no probaría nada"; exit 1; }

# ── 2. La copia ────────────────────────────────────────────────────────────
echo "→ 2/6  volcando"
"${RUN[@]}" pg_dump -h "$PGHOST" -p "$PGPORT" -d origen -Fc -f "$WORK/copia.dump"
[ -s "$WORK/copia.dump" ] || { echo "✘ el volcado salió vacío"; exit 1; }

# ── 3. LA DESTRUCCIÓN ──────────────────────────────────────────────────────
#
# El paso que convierte esto en un simulacro y no en una comprobación de que
# `pg_dump` sabe escribir ficheros. Sin destruir, todo lo de abajo pasaría
# aunque la restauración no hiciera absolutamente nada.
echo "→ 3/6  DESTRUYENDO la base de origen"
"${RUN[@]}" dropdb -h "$PGHOST" -p "$PGPORT" origen
"${RUN[@]}" createdb -h "$PGHOST" -p "$PGPORT" -E UTF8 origen
QUEDA="$(sin_eco origen -c "select count(*) from information_schema.tables where table_schema = 'public'")"
[ "$QUEDA" = "0" ] || { echo "✘ la base no quedó vacía: el simulacro no probaría nada"; exit 1; }

# ── 4. La vuelta ───────────────────────────────────────────────────────────
echo "→ 4/6  restaurando"
"${RUN[@]}" pg_restore -h "$PGHOST" -p "$PGPORT" -d origen --no-owner --no-privileges "$WORK/copia.dump" >/dev/null 2>&1 || true
# `pg_restore` avisa de cosas que no importan (roles que no existen en este
# cluster) y devuelve distinto de cero por ellas. Lo que decide si la
# restauración sirvió no es su código de salida: es la comprobación de abajo.

# ── 5. ¿SIRVE? ─────────────────────────────────────────────────────────────
echo "→ 5/6  comprobando que lo restaurado sirve"
verificar() {
  "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d origen -tAX -F'|' \
    -f "$ROOT/supabase/verify/restauracion.sql"
}
SALIDA="$(verificar)"
echo "$SALIDA" | sed 's/^/     /'
MALAS="$(echo "$SALIDA" | grep -c '|REVISAR|' || true)"
if [ "$MALAS" != "0" ]; then
  echo "✘ la base restaurada NO sirve: $MALAS comprobaciones en rojo"
  exit 1
fi

EMPRESAS2="$(sin_eco origen -c 'select count(*) from organizations')"
VENTAS2="$(sin_eco origen -c 'select count(*) from sales_order')"
[ "$EMPRESAS" = "$EMPRESAS2" ] && [ "$VENTAS" = "$VENTAS2" ] || {
  echo "✘ los recuentos no cuadran: antes $EMPRESAS/$VENTAS, después $EMPRESAS2/$VENTAS2"; exit 1; }
echo "     recuentos iguales: $EMPRESAS2 empresas, $VENTAS2 ventas"

# ── 6. Y QUE LA COMPROBACIÓN SEPA FALLAR ───────────────────────────────────
#
# Lo más importante del simulacro. Una verificación que siempre dice OK es
# exactamente igual de útil que no tenerla, y no hay forma de distinguirlas
# mirándola: hay que romper la base a propósito y ver si se entera.
echo "→ 6/6  rompiendo a propósito, para ver si la comprobación se entera"
# Se exige además QUÉ fila lo caza. Sin eso, una rotura que trepa por las
# dependencias y hace saltar otra comprobación cualquiera dejaría la de verdad
# sin probar — y esa es exactamente la forma de tener diez comprobaciones de las
# que solo funcionan tres.
caza() { # <fila esperada> <etiqueta> <sql que rompe>
  "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d origen -v ON_ERROR_STOP=1 -q -c "$3" >/dev/null
  local salida; salida="$(verificar)"
  if echo "$salida" | grep -E "^$1 ·" | grep -q '|REVISAR|'; then
    echo "     ✔ caza: $2   (fila $1)"
  else
    echo "✘ la fila $1 NO se enteró de: $2"
    echo "$salida" | sed 's/^/       /'
    exit 1
  fi
}

# a) El enganche del token sin `security definer`: GoTrue devuelve 500 al entrar.
caza 3 "el enganche pierde security definer" \
  "alter function app.custom_access_token_hook(jsonb) security invoker;"
"${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d origen -q \
  -c "alter function app.custom_access_token_hook(jsonb) security definer;" >/dev/null

# b) Una sola tabla sin RLS: el aislamiento entre empresas deja de existir.
caza 5 "una tabla de negocio se queda sin RLS" \
  "alter table booking disable row level security;"
"${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d origen -q \
  -c "alter table booking enable row level security;" >/dev/null

# c) Las ayudas de inquilino: sin ellas ninguna política se puede evaluar.
#
# Se RENOMBRA en vez de borrarse: un `drop ... cascade` se lleva por delante las
# políticas que la usan y entonces lo que salta es la comprobación 6a, no la 2 —
# la rotura se cazaría, pero por el motivo equivocado, y la 2 se quedaría sin
# probar sin que nadie lo notase. Renombrando, la política sigue en pie (Postgres
# guarda la dependencia por identificador, no por nombre) y lo único que cambia
# es que la función ya no se llama como se tiene que llamar.
caza 2 "desaparece una ayuda de inquilino" \
  "alter function app.current_partner_id() rename to current_partner_id_perdida;"
"${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d origen -q \
  -c "alter function app.current_partner_id_perdida() rename to current_partner_id;" >/dev/null

# d) Un volcado de solo `public` deja `auth.users` vacío: la base está entera y
#    NADIE puede entrar. Es la forma de restauración rota que más tarda en
#    notarse, porque no se ve hasta que alguien intenta iniciar sesión.
#
#    Se desactivan las claves ajenas para provocarlo, y no es una trampa: es
#    EXACTAMENTE lo que hace `pg_restore --disable-triggers`, que es como se
#    restaura un volcado de solo datos. Con las claves puestas, borrar las
#    cuentas se lleva por delante las membresías y no queda ninguna colgando —
#    o sea que el escenario que importa no se puede montar de otra forma.
caza 9 "las cuentas se quedan fuera del volcado" \
  "set session_replication_role = replica; delete from auth.users; set session_replication_role = origin;"

echo "✔ simulacro de restauración en verde: se vuelve, y la comprobación sabe fallar"
