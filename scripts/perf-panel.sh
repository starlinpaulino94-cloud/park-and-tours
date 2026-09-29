#!/usr/bin/env bash
# ============================================================================
# P-001 · QUÉ AGUANTA EL PANEL, Y SI SE PUEDE SEGUIR VENDIENDO MIENTRAS TANTO
#
# Levanta un Postgres efímero con TODAS las migraciones, siembra el volumen de
# `supabase/perf/volumen.sql` y mide tres cosas:
#
#   1. un solo cliente, ventana de 30 días (la que trae el panel por defecto) y
#      de 365 (la que ofrece el selector);
#   2. el mismo panel con 1, 2, 4, 8 y 16 clientes a la vez;
#   3. el camino de VENDER —coger plaza y soltarla— mientras el panel está
#      cargado, que es la pregunta que de verdad importa: si alguien abre el
#      informe del año, ¿sigo pudiendo cobrar?
#
# ───────────────────────────────────────────────────────────────────────────
# ESTO NO ES UNA PRUEBA: NO AFIRMA MILISEGUNDOS
#
# Un tope de milisegundos en CI es una prueba inestable, y una prueba inestable
# se acaba reejecutando hasta que pasa. Esto IMPRIME números para que alguien
# los lea y los compare con los del registro. Lo que sí se afirma, de forma
# determinista, está en `supabase/tests/dashboard_plan.test.sql` y en
# `ui-contracts.test.ts`: el ancho de la proyección, el índice del camino
# filtrado y cuántas veces se barre `booking`.
#
# Requisitos: postgres 16. No toca ninguna base remota.
# Uso:  bash scripts/perf-panel.sh            (volumen completo, ~4 min)
#       ESCALA=10 bash scripts/perf-panel.sh  (una décima parte, para probar)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ESCALA="${ESCALA:-1}"
CLIENTES="${CLIENTES:-1 2 4 8 16}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
[ -n "${PGBIN:-}" ] && export PATH="$PGBIN:$PATH"
command -v initdb >/dev/null || { echo "initdb no encontrado; instala postgresql-16 o exporta PGBIN"; exit 1; }

WORK="$(mktemp -d)"
export PGDATA="$WORK/data" PGHOST="$WORK/sock" PGPORT="${PGPORT:-54398}" PGDATABASE=appdb
mkdir -p "$PGHOST" "$WORK/lat"
cleanup() { pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

RUN=(); if [ "$(id -u)" = "0" ]; then RUN=(runuser -u postgres --); chown -R postgres:postgres "$WORK"; fi
run_psql() { "${RUN[@]}" psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -d appdb "$@"; }

# Parámetros de una instancia pequeña, no los de fábrica de `initdb`: medir con
# 128 kB de `work_mem` mide otra base.
"${RUN[@]}" initdb -D "$PGDATA" -A trust --encoding=UTF8 --no-locale >/dev/null
"${RUN[@]}" pg_ctl -D "$PGDATA" -w start >/dev/null \
  -o "-p $PGPORT -k $PGHOST -c listen_addresses='' -c shared_buffers=256MB -c work_mem=4MB -c max_connections=100 -c effective_cache_size=1GB"
"${RUN[@]}" createdb -h "$PGHOST" -p "$PGPORT" -E UTF8 appdb

echo "→ esquema"
run_psql -q -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/0*.sql; do
  run_psql -q -f "$f" >/dev/null 2>&1 || { echo "✘ no aplica $(basename "$f")"; exit 1; }
done

echo "→ volumen (escala $ESCALA)"
cp "$ROOT/supabase/perf/volumen.sql" "$WORK/volumen.sql"
[ "$(id -u)" = "0" ] && chown postgres "$WORK/volumen.sql"
run_psql -q -c "set perf.escala = $ESCALA" -f "$WORK/volumen.sql" | sed 's/^/  /'

ORG="$(run_psql -At -c "select id from organizations where name = 'Operadora P-001'")"
NUCLEOS="$(nproc 2>/dev/null || echo '?')"

# ── Un cliente: N llamadas al panel, una por línea de tiempo ────────────────
cat > "$WORK/panel.sh" <<PANEL
#!/usr/bin/env bash
VENTANA="\$1"; VECES="\$2"; SALIDA="\$3"
{
  echo "select set_config('request.jwt.claims', json_build_object('org_id', '$ORG', 'app_role', 'owner')::text, false);"
  echo "\\\\timing on"
  for i in \$(seq 1 "\$VECES"); do
    echo "select length(public.dashboard_summary('$ORG'::uuid, current_date - \$VENTANA, current_date, current_date - \$((VENTANA * 2)), current_date - \$((VENTANA + 1)), 'usd', 'America/Santo_Domingo', null, null, null, null, null, 'sales', null)::text);"
  done
} | psql -q -h "$PGHOST" -p "$PGPORT" -d appdb > "\$SALIDA" 2>&1
PANEL
chmod +x "$WORK/panel.sh"

# ── El camino de vender, mientras tanto ────────────────────────────────────
cat > "$WORK/vender.sh" <<VENDER
#!/usr/bin/env bash
VECES="\$1"
SAL="\$(psql -At -h "$PGHOST" -p "$PGPORT" -d appdb -c "select id from departure where organization_id = '$ORG' and departure_at > now() order by departure_at limit 1")"
{
  echo "select set_config('request.jwt.claims', json_build_object('org_id', '$ORG', 'app_role', 'owner')::text, false);"
  echo "\\\\timing on"
  for i in \$(seq 1 "\$VECES"); do
    echo "select public.reserve_departure_capacity('\$SAL'::uuid, 1, 15);"
    echo "select public.release_departure_capacity('\$SAL'::uuid, 1);"
  done
} | psql -q -h "$PGHOST" -p "$PGPORT" -d appdb > "$WORK/venta.txt" 2>&1
VENDER
chmod +x "$WORK/vender.sh"
[ "$(id -u)" = "0" ] && chown -R postgres:postgres "$WORK"

resumen() {  # $1 = etiqueta, $2 = glob de ficheros, $3 = segundos de pared
  grep -ho "Time: [0-9.]*" $2 2>/dev/null | awk '{print $2}' |
  ESQ="$1" PARED="$3" python3 "$WORK/resumen.py"
}

cat > "$WORK/resumen.py" <<'RESUMEN'
import os, sys, statistics

etiqueta = os.environ["ESQ"]
pared = float(os.environ["PARED"])
xs = sorted(float(x) for x in sys.stdin if x.strip())
if not xs:
    print(f"{etiqueta:<30} SIN DATOS")
    raise SystemExit
pct = lambda q: xs[min(len(xs) - 1, int(len(xs) * q))]
caudal = f"{len(xs) / pared:6.2f}/s" if pared > 0 else "      -"
print(f"{etiqueta:<30} n={len(xs):<4} p50 {statistics.median(xs):8.1f} ms  "
      f"p95 {pct(0.95):8.1f} ms  max {xs[-1]:8.1f} ms  {caudal}")
RESUMEN

echo
echo "── el panel, un solo cliente ($NUCLEOS núcleos) ────────────────────────────"
for v in 30 365; do
  "${RUN[@]}" "$WORK/panel.sh" "$v" 1 "$WORK/lat/calienta.txt" >/dev/null 2>&1 || true
  rm -f "$WORK"/lat/*.txt
  "${RUN[@]}" "$WORK/panel.sh" "$v" 5 "$WORK/lat/u.txt"
  resumen "ventana de $v días" "$WORK/lat/u.txt" 0
done

echo
echo "── el mismo panel de 365 días, con gente a la vez ──────────────────────────"
for k in $CLIENTES; do
  rm -f "$WORK"/lat/*.txt
  INI=$(date +%s.%N)
  for i in $(seq 1 "$k"); do "${RUN[@]}" "$WORK/panel.sh" 365 3 "$WORK/lat/c$i.txt" & done
  wait
  FIN=$(date +%s.%N)
  resumen "$k cliente(s) a la vez" "$WORK/lat/c*.txt" "$(echo "$FIN - $INI" | bc)"
done

echo
echo "── ¿se puede seguir vendiendo mientras el panel trabaja? ───────────────────"
for k in 0 4 8 16; do
  if [ "$k" != 0 ]; then
    rm -f "$WORK"/lat/*.txt
    for i in $(seq 1 "$k"); do "${RUN[@]}" "$WORK/panel.sh" 365 6 "$WORK/lat/c$i.txt" & done
    sleep 1
  fi
  "${RUN[@]}" "$WORK/vender.sh" 20
  resumen "coger plaza · $k en el panel" "$WORK/venta.txt" 0
  [ "$k" != 0 ] && wait
done

echo
echo "Los números de referencia y lo que se midió y se DESCARTÓ están en"
echo "docs/audit/FIX_LOG.md, en la entrada de P-001."
