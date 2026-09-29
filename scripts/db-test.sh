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

# ── Lo que se PEGA, ejecutado y leído ───────────────────────────────────────
#
# Las copias de `supabase/editor/` son lo que alguien pega contra SU base de
# producción. Que digan lo mismo que la migración se comprueba en
# `editor-sql.test.ts`; lo que aquí se comprueba es que CORREN, y que su
# verificación sabe decir que algo va mal.
#
# Se eligen las de 0102 porque son idempotentes por construcción —cada trozo
# empieza por `drop trigger if exists`— así que volver a pegarlas sobre una base
# que ya las tiene es exactamente lo que hará quien las repita.
echo "→ las copias de 0102 que se pegan en el editor"
for pf in "$ROOT"/supabase/editor/0102_parte_[123].sql; do
  [ -e "$pf" ] || { echo "✘ falta $pf"; fail=1; continue; }
  [ "$(id -u)" = "0" ] && chown postgres "$pf" 2>/dev/null
  if ! psql_run -f "$pf" >/dev/null; then
    echo "✘ $(basename "$pf") no corre contra el esquema actual"; fail=1
  fi
done
VERIF="$ROOT/supabase/editor/0102_parte_4_verificacion.sql"
if [ -e "$VERIF" ]; then
  [ "$(id -u)" = "0" ] && chown postgres "$VERIF" 2>/dev/null
  SALIDA=$(psql_run -At -f "$VERIF" 2>&1 || true)
  # La verificación devuelve filas legibles; ninguna puede decir que falta algo.
  if echo "$SALIDA" | grep -q 'FALTA'; then
    echo "✘ la verificación de 0102 dice que falta algo:"; echo "$SALIDA" | grep 'FALTA'; fail=1
  elif echo "$SALIDA" | grep -q 'HAY sin comprobar'; then
    echo "✘ la verificación de 0102 encontró referencias a una persona sin comprobar:"
    echo "$SALIDA" | grep 'HAY sin comprobar'; fail=1
  elif [ -z "$SALIDA" ]; then
    echo "✘ la verificación de 0102 no devolvió ninguna fila: no verificó nada"; fail=1
  else
    echo "  las 4 filas de la verificación de 0102 se leen y ninguna acusa"
  fi
else
  echo "✘ falta la verificación de 0102"; fail=1
fi

# ── «¿Qué migraciones me faltan?», contra una base que NO le falta ninguna ──
#
# `que_me_falta_*.sql` y `auditoria_*.sql` son la respuesta que alguien lee
# antes de tocar su producción. Se generan, así que no se quedan atrás; lo que
# no comprobaba nadie es que ACIERTEN. Aquí se corren contra la base efímera,
# que tiene TODAS las migraciones aplicadas: ni una sola fila puede decir FALTA.
#
# Un falso «FALTA» manda a ejecutar otra vez algo que ya está, y enseña a
# desconfiar de la consulta — que es la forma de que la próxima vez nadie la
# mire. Es el mismo fallo que ya apareció una vez con 0038 y 0081.
echo "→ la consulta de «qué migraciones me faltan», contra todo aplicado"
consultas=0; consultas_mal=0
for cf in "$ROOT"/supabase/editor/que_me_falta_*.sql \
          "$ROOT"/supabase/editor/auditoria_migraciones*.sql \
          "$ROOT"/supabase/editor/auditoria_funciones_*.sql; do
  [ -e "$cf" ] || continue
  [ "$(id -u)" = "0" ] && chown postgres "$cf" 2>/dev/null
  SAL=$(psql_run -At -f "$cf" 2>&1 || true)
  if [ -z "$SAL" ]; then
    echo "✘ $(basename "$cf") no devolvió ninguna fila: no comprueba nada"; fail=1
    consultas_mal=1
  elif echo "$SAL" | grep -q 'FALTA'; then
    echo "✘ $(basename "$cf") dice que faltan migraciones que SÍ están aplicadas:"
    echo "$SAL" | grep 'FALTA' | head -5; fail=1
    consultas_mal=1
  fi
  consultas=$((consultas + 1))
done
# Cero consultas corridas también es un fallo: el `for` sobre un patrón que no
# casa con nada deja el bucle vacío y el mensaje de abajo diría que todo bien.
if [ "${consultas:-0}" -lt 5 ]; then
  echo "✘ solo se corrieron ${consultas:-0} consultas de auditoría: faltan ficheros"; fail=1
elif [ "${consultas_mal:-0}" = "0" ]; then
  echo "  ${consultas} consultas de auditoría y ninguna acusa de falta lo que está puesto"
fi

# ── La siembra de rendimiento, a escala pequeña ─────────────────────────────
#
# `supabase/perf/volumen.sql` es lo que `scripts/perf-panel.sh` usa para medir
# qué aguanta el panel. Ese banco se corre a mano, de vez en cuando; el esquema
# cambia todas las semanas. Una siembra de rendimiento que ya no encaja NO
# avisa: falla el día que alguien quiere medir, que es el peor día.
#
# Aquí se corre a escala 100 —1.200 reservas en vez de 120.000, unos segundos—
# solo para comprobar que sigue encajando. Lo que se mide de verdad no se mide
# aquí: un tope de milisegundos en CI es una prueba inestable.
echo "→ la siembra de rendimiento sigue encajando con el esquema"
if [ -f "$ROOT/supabase/perf/volumen.sql" ]; then
  PERF="$WORK/volumen.sql"; cp "$ROOT/supabase/perf/volumen.sql" "$PERF"
  [ "$(id -u)" = "0" ] && chown postgres "$PERF"
  if ! psql_run -q -c "set perf.escala = 100" -f "$PERF" >/dev/null 2>&1; then
    echo "✘ supabase/perf/volumen.sql ya no corre contra el esquema actual: el banco de P-001 no mediría nada"; fail=1
  else
    # Que corra no basta: a escala 100 una versión anterior dejaba DOS salidas y
    # solo seis de las 1.200 órdenes llegaban a ser reserva. La siembra no
    # fallaba; devolvía una base con la que no se puede medir.
    PR=$(psql_run -At -c "select count(*) from booking where organization_id = (select id from organizations where name = 'Operadora P-001');" 2>/dev/null | tr -d '[:space:]')
    PO=$(psql_run -At -c "select count(*) from sales_order where organization_id = (select id from organizations where name = 'Operadora P-001');" 2>/dev/null | tr -d '[:space:]')
    if [ "${PR:-0}" -lt 1000 ] 2>/dev/null || [ "${PR:-0}" != "${PO:-0}" ]; then
      echo "✘ la siembra de rendimiento dejó ${PR:-0} reservas para ${PO:-0} órdenes: a escala 1 mediría sobre una base a medias"; fail=1
    else
      echo "  $PR reservas y $PO órdenes a escala 100: el banco sigue pudiendo medir"
    fi
    # Y se retira: el resto de comprobaciones cuentan filas de la demostración.
    psql_run -q -c "delete from organizations where name in ('Operadora P-001','Socio P-001');" >/dev/null 2>&1 || true
  fi
else
  echo "✘ falta supabase/perf/volumen.sql"; fail=1
fi

# ── Ningún módulo puede quedarse vacío en silencio ──────────────────────────
#
# De dónde sale esto: se reportó «hay varios módulos que se crearon y están
# totalmente vacíos». Medido sobre la base recién sembrada, era cierto —y el
# código estaba: lo que faltaba eran los DATOS—. `organizations` con
# `kind='partner'` tenía cero filas, y con ella se quedaban vacías las cuatro
# tablas del socio, o sea las fases 4, 5 y 6 enteras sin nada con que verse.
#
# Un módulo sin datos no se puede ni mirar: desde la pantalla no se distingue
# «no hay nada» de «no funciona». Así que a partir de aquí eso es un fallo de
# construcción, no un descubrimiento en mitad de una demostración.
#
# La lista crece según se van cubriendo bloques. Lo que NO está aquí, no está
# cubierto — y se dice, en vez de dejarlo en blanco.
echo "→ cobertura de datos de demostración"
COBERTURA="organizations organization_relationships partner_product allotment partner_wallet_movement price_rule product departure booking sales_order payment commission invoice customer seller supplier seller_attribution commission_adjustment"
for tabla in $COBERTURA; do
  n=$(psql_run -At -c "select count(*) from public.$tabla;" 2>/dev/null | tr -d '[:space:]')
  if [ "${n:-0}" = "0" ]; then
    echo "✘ el módulo $tabla se quedó SIN datos de demostración: su pantalla saldrá vacía"; fail=1
  fi
done
# Y el socio, con lo suyo: dos formas de trabajar que el sistema declara
# excluyentes. Con una sola no se ve la diferencia, que es de lo que va el módulo.
MODELOS=$(psql_run -At -c "select count(distinct pricing_model) from organization_relationships;" 2>/dev/null | tr -d '[:space:]')
if [ "${MODELOS:-0}" -lt 2 ] 2>/dev/null; then
  echo "✘ la demo solo enseña un modelo de precio de socio: comisión y neto tienen que verse los dos"; fail=1
else
  echo "  18 módulos con datos; socio a comisión y a neto, los dos"
fi

# ── El embudo tiene que ESTRECHARSE ────────────────────────────────────────
#
# Filas no es lo mismo que datos útiles. El informe cuenta PERSONAS por etapa,
# así que un sembrador que pusiera las cuatro etapas con el mismo reparto daría
# un embudo recto: cuatro cifras iguales y ninguna conversión que mirar. Se
# comprueba la forma, no el recuento.
VISITAS=$(psql_run -At -c "select count(distinct visitor_id) from seller_attribution where stage = 'visit';" 2>/dev/null | tr -d '[:space:]')
COMPRAS=$(psql_run -At -c "select count(distinct customer_id) from seller_attribution where stage = 'purchase';" 2>/dev/null | tr -d '[:space:]')
ETAPAS=$(psql_run -At -c "select count(distinct stage) from seller_attribution;" 2>/dev/null | tr -d '[:space:]')
if [ "${ETAPAS:-0}" -lt 4 ] 2>/dev/null; then
  echo "✘ el embudo de demostración no tiene las cuatro etapas: no se ve ninguna conversión"; fail=1
elif [ "${VISITAS:-0}" -le "${COMPRAS:-0}" ] 2>/dev/null; then
  echo "✘ el embudo de demostración no se estrecha: $VISITAS visitas y $COMPRAS compras"; fail=1
else
  echo "  embudo de $VISITAS visitantes a $COMPRAS compradores, con sus cuatro etapas"
fi

# Y «compra» quiere decir COBRADA. La regla no me la invento: `recordPurchaseOnce`
# solo se llama cuando la orden queda en `paid`, y el comentario de ese sitio dice
# por qué —contar una reserva que nadie pagó infla el cierre de quien las deja
# colgadas por encima del que cobra—. Si el sembrador no respeta esa regla, la demo
# enseña un embudo que el producto nunca produciría.
#
# Esto lo escribo porque una mutación SOBREVIVIÓ: sembrar la compra de TODAS las
# órdenes deja el embudo estrechándose igual (120 → 40) y la guarda de forma lo
# daba por bueno. La forma no basta; hace falta el invariante.
FANTASMAS=$(psql_run -At -c "select count(*) from seller_attribution a join sales_order o on o.id = a.order_id where a.stage = 'purchase' and o.status not in ('paid','completed');" 2>/dev/null | tr -d '[:space:]')
if [ "${FANTASMAS:-0}" != "0" ] 2>/dev/null; then
  echo "✘ $FANTASMAS paso(s) de «compra» sobre órdenes que nadie pagó: el embudo miente"; fail=1
fi

# ── Y el ajuste tiene que haber movido el neto ─────────────────────────────
#
# Un ajuste escrito junto a un neto que no se enteró es justo el descuadre que
# este bloque corrige en el código: la liquidación transfiere el neto y la
# pantalla enseñaría el bruto. Si la demo lo reprodujera, enseñaría el fallo.
DESCUADRE=$(psql_run -At -c "select count(*) from commission c where c.adjustment_total <> 0 and c.net_amount is distinct from greatest(0, round(c.amount + c.adjustment_total, 2));" 2>/dev/null | tr -d '[:space:]')
CONAJUSTE=$(psql_run -At -c "select count(*) from commission where adjustment_total <> 0;" 2>/dev/null | tr -d '[:space:]')
if [ "${CONAJUSTE:-0}" = "0" ]; then
  echo "✘ ninguna comisión de demostración tiene ajuste: el módulo sigue sin poder verse"; fail=1
elif [ "${DESCUADRE:-0}" != "0" ]; then
  echo "✘ $DESCUADRE comisión(es) con ajuste y el neto sin actualizar: la demo enseñaría el descuadre"; fail=1
else
  echo "  $CONAJUSTE comisiones ajustadas, con su neto al día y su liquidación"
fi

# Y enganchados a la liquidación que se los llevó: la columna existe desde 0059
# y hasta este bloque no la escribía nadie.
SUELTOS=$(psql_run -At -c "select count(*) from commission_adjustment where settlement_id is null;" 2>/dev/null | tr -d '[:space:]')
if [ "${SUELTOS:-0}" != "0" ] 2>/dev/null; then
  echo "✘ $SUELTOS ajuste(s) sin liquidación: no se puede decir qué cierre se llevó el descuento"; fail=1
fi

# ── La carrera de verdad (F-001) ────────────────────────────────────────────
#
# Una prueba SQL corre en UNA sesión, y una carrera necesita dos. Esto lanza N
# ventas de la misma plaza en paralelo y cuenta lo que quedó escrito.
#
# POR QUÉ ESTÁ AQUÍ Y NO EN supabase/tests/
#
# Porque sin concurrencia real no prueba nada. Medido con el camino que usaba la
# aplicación —leer `departure_pax_totals`, decidir fuera, insertar después—:
# 30 ventas simultáneas de una plaza contra una salida de 10 dejaban DIECINUEVE
# reservas. Por `reserve_departure_capacity`, exactamente 10.
#
# Se comprueban las dos cosas, y las dos importan: que no se venda de más
# —sobreventa— y que no se venda de menos —el cerrojo dejando plazas sin
# vender—. Un cerrojo que rechaza todo también pasaría la mitad de la prueba.
# ── Las carreras de la CAJA ─────────────────────────────────────────────────
#
# La última de la dimensión F. Dos caminos, los dos comprobar-y-actuar:
#
#  · ABRIR: la ruta lee si esa caja tiene sesión abierta y, si no, crea una. Dos
#    cajeros que abran a la vez dejan DOS turnos abiertos sobre el mismo cajón:
#    los cobros se reparten entre los dos y ninguno de los arqueos cuadra.
#
#  · CERRAR: la ruta lee el estado, comprueba que sea `open` y luego escribe el
#    conteo, el movimiento de cierre y el asiento del descuadre. Dos cierres a
#    la vez lo escriben todo DOS VECES — y el movimiento de cierre lo suma el
#    recálculo, así que además envenena el esperado de cualquier arqueo
#    posterior.
echo "→ carreras de la caja: abrir y cerrar el mismo turno a la vez"
CAJA_SQL="$WORK/caja.sql"
cat > "$CAJA_SQL" <<'EOSQL'
insert into organizations (id, name, kind)
  values ('cccccccc-0000-0000-0000-0000000000d0', 'Carrera caja', 'tenant')
  on conflict (id) do nothing;
insert into cash_register (id, organization_id, name, currency, status)
  values ('cccccccc-0000-0000-0000-0000000000d1', 'cccccccc-0000-0000-0000-0000000000d0',
          'Caja de la carrera', 'usd', 'active')
  on conflict (id) do nothing;
delete from cash_count    where cash_session_id in (select id from cash_session where organization_id = 'cccccccc-0000-0000-0000-0000000000d0');
delete from cash_movement where cash_session_id in (select id from cash_session where organization_id = 'cccccccc-0000-0000-0000-0000000000d0');
delete from cash_session  where organization_id = 'cccccccc-0000-0000-0000-0000000000d0';
EOSQL
[ "$(id -u)" = "0" ] && chown postgres "$CAJA_SQL"
if ! psql_run -f "$CAJA_SQL" >/dev/null; then
  echo "✘ no se pudo preparar la carrera de la caja"; fail=1
else
  ORGC=cccccccc-0000-0000-0000-0000000000d0
  REG=cccccccc-0000-0000-0000-0000000000d1

  # ABRIR: veinte a la vez, cada uno como la ruta —mirar y crear—.
  for i in $(seq 1 20); do
    "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d appdb -At -c "
      do \$m\$
      begin
        -- Fiel a la ruta: mirar si ya hay turno abierto...
        if exists (select 1 from cash_session
                    where organization_id = '$ORGC' and cash_register_id = '$REG'
                      and status = 'open') then return; end if;
        -- ...leer la caja, comprobar el rango y el dueño...
        perform pg_sleep(0.05);
        -- ...y crear el turno. Sin el índice de 0101 aquí entraban 18.
        insert into cash_session (organization_id, cash_register_id, opening_amount, currency, status, code)
          values ('$ORGC', '$REG', 100, 'usd', 'open', 'CJ-$i');
      end \$m\$;" >/dev/null 2>&1 &
  done
  wait
  ABIERTAS=$(psql_run -At -c "select count(*) from cash_session where organization_id = '$ORGC' and status = 'open';" | tr -d '[:space:]')
  if [ "${ABIERTAS:-0}" != "1" ]; then
    echo "✘ DOS CAJONES PARA EL MISMO DINERO: $ABIERTAS turnos abiertos sobre la misma caja"; fail=1
  else
    echo "  20 aperturas simultáneas, 1 turno abierto"
  fi

  # CERRAR: veinte a la vez contra el turno que quedó abierto.
  TURNO=$(psql_run -At -c "select id from cash_session where organization_id = '$ORGC' and status = 'open' limit 1;" | tr -d '[:space:]')
  if [ -n "${TURNO:-}" ]; then
    for i in $(seq 1 20); do
      "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d appdb -At -c "
        do \$m\$
        begin
          -- Fiel a la ruta desde 0101: recalcular y validar el conteo primero...
          perform pg_sleep(0.05);
          -- ...y RECLAMAR la transición antes de escribir nada. Quien pierde
          -- sale sin tocar el libro; antes escribía el conteo, el movimiento de
          -- cierre y el asiento del descuadre igual que el que ganaba.
          if public.claim_cash_session_status('$TURNO', 'open', 'closed', now(), null) is not true then
            return;
          end if;
          insert into cash_count (organization_id, cash_session_id, currency, kind, counted_total)
            values ('$ORGC', '$TURNO', 'usd', 'close', 100);
          -- El movimiento de cierre NO tiene índice único, y es el que mide de
          -- verdad si la transición serializa: si se cuenta solo el conteo, lo
          -- que se está midiendo es cash_count_unique_idx, que existe desde
          -- 0038 por una razón de forma y no como defensa de esta carrera.
          -- Además el recálculo lo SUMA, así que duplicarlo envenena el
          -- esperado de cualquier arqueo posterior.
          insert into cash_movement (organization_id, cash_session_id, movement_type, amount, currency, concept)
            values ('$ORGC', '$TURNO', 'closing', 100, 'usd', 'Cierre de caja / arqueo');
        end \$m\$;" >/dev/null 2>&1 &
    done
    wait
    CIERRES=$(psql_run -At -c "select count(*) from cash_movement where cash_session_id = '$TURNO' and movement_type = 'closing';" | tr -d '[:space:]')
    if [ "${CIERRES:-0}" != "1" ]; then
      echo "✘ EL TURNO SE CERRÓ $CIERRES VECES: conteo, movimiento y asiento del descuadre, duplicados"; fail=1
    else
      echo "  20 cierres simultáneos, 1 cierre escrito"
    fi

    # ── APROBAR EL DESCUADRE ───────────────────────────────────────────────
    #
    # Ésta no tenía NINGUNA defensa: la ruta leía `pending_approval`, escribía
    # `reconciled` y asentaba la diferencia en el libro diario. Lo único que lo
    # impedía era `alreadyPosted`, que es una lectura — las dos miran, las dos no
    # encuentran nada, las dos asientan. Un faltante de caja contabilizado dos
    # veces no lo nota nadie hasta que no cuadra el balance.
    psql_run -c "
      update cash_session set status = 'pending_approval', difference = -25
       where id = '$TURNO';
      insert into ledger_account (organization_id, code, name, account_type)
      select '$ORGC', c.code, c.name, c.tipo
        from (values ('1101','Caja','asset'), ('5206','Faltantes','expense')) as c(code, name, tipo)
       where not exists (select 1 from ledger_account
                          where organization_id = '$ORGC' and code = c.code);" >/dev/null 2>&1
    for i in $(seq 1 20); do
      "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d appdb -At -c "
        do \$m\$
        declare v_cuenta uuid;
        begin
          -- Fiel a la ruta desde 0101: reclamar la transición y solo entonces
          -- asentar. Y detrás, el índice único del libro por si alguien mueve
          -- el asiento a otro sitio.
          if public.claim_cash_session_status('$TURNO', 'pending_approval', 'reconciled', now(), null) is not true then
            return;
          end if;
          perform pg_sleep(0.05);
          select id into v_cuenta from ledger_account
           where organization_id = '$ORGC' and code = '5206' limit 1;
          insert into ledger_entry (organization_id, source_type, cash_session_id, line_no,
                                    ledger_account_id, debit, currency, posted_at)
            values ('$ORGC', 'cash_close', '$TURNO', 1, v_cuenta, 25, 'usd', now());
        end \$m\$;" >/dev/null 2>&1 &
    done
    wait
    ASIENTOS=$(psql_run -At -c "select count(*) from ledger_entry where cash_session_id = '$TURNO' and source_type = 'cash_close';" | tr -d '[:space:]')
    if [ "${ASIENTOS:-0}" != "1" ]; then
      echo "✘ EL DESCUADRE SE ASENTÓ $ASIENTOS VECES en el libro diario"; fail=1
    else
      echo "  20 aprobaciones simultáneas, 1 asiento en el libro"
    fi
  fi
fi

# ── El contador fiscal de la demo, al día ───────────────────────────────────
#
# El sembrador escribe las facturas con su NCF directamente, sin pasar por
# `next_ncf`, así que el contador se quedaba en 1 con 59 comprobantes emitidos:
# la primera factura desde la demo habría REPETIDO un NCF que ya existe. Dos
# comprobantes con el mismo número no es un descuadre, es una factura que la
# DGII rechaza.
#
# Lo encontró la fila 11 de `supabase/verify/restauracion.sql`, que existe para
# cazar esto tras una restauración a un punto anterior. Se comprueba también
# aquí porque el simulacro corre el sembrador MONOLÍTICO y esto corre además los
# trozos: el arreglo tiene que estar en los dos, y sin esta línea el de los
# trozos podía quedarse atrás sin que nada avisara.
NCF_ATRAS=$(psql_run -At -c "
  select count(*) from ncf_sequence q
   where exists (
     select 1 from invoice i
      where i.organization_id = q.organization_id
        and lower(i.ncf_type) = lower(q.ncf_type)
        and substring(i.ncf from length(q.ncf_type) + 1) ~ '^[0-9]+\$'
        and nullif(substring(i.ncf from length(q.ncf_type) + 1), '')::bigint >= q.next_number);" 2>/dev/null | tr -d '[:space:]')
if [ "${NCF_ATRAS:-0}" != "0" ]; then
  echo "✘ $NCF_ATRAS secuencia(s) de NCF por detrás de lo emitido: la próxima factura repetiría un número fiscal"; fail=1
else
  echo "  el contador de NCF va por delante de lo emitido"
fi

# ── La carrera del CUPO DEL SOCIO ───────────────────────────────────────────
#
# El informe de preparación deja abierta la dimensión F con «quedan sin medir
# las demás carreras (caja, monedero, cupo del socio)». El monedero ya se
# serializa con un cerrojo sobre la fila del socio (0091). Éste no.
#
# LO QUE HACE LA APLICACIÓN, TAL CUAL
#
# `assertAllotment` lee la fila al EMPEZAR la venta y comprueba las plazas que
# quedan. `consumeAllotment` escribe, al TERMINARLA, `seats_used = <lo que
# leyó> + pax`. Entre las dos pasa la venta entera: precio, cupo de la salida,
# reservas, cobro. Y la escritura no es un incremento, es un valor absoluto
# calculado sobre una lectura vieja.
#
# Esto reproduce ese par con N procesos a la vez. Cada uno lee, espera un poco
# —la venta— y escribe lo que leyó más uno. Si el contador fuera correcto, 30
# ventas de una plaza dejarían `seats_used` en el tope del cupo y ni una más.
echo "→ carrera: 30 ventas del socio contra un cupo de 10 plazas"
CUPO_SQL="$WORK/cupo.sql"
cat > "$CUPO_SQL" <<'EOSQL'
insert into organizations (id, name, kind)
  values ('cccccccc-0000-0000-0000-0000000000c0', 'Carrera cupo', 'tenant')
  on conflict (id) do nothing;
insert into organizations (id, name, kind, tenant_org_id)
  values ('cccccccc-0000-0000-0000-0000000000c1', 'Socio de la carrera', 'partner',
          'cccccccc-0000-0000-0000-0000000000c0')
  on conflict (id) do nothing;
insert into product (id, organization_id, name, base_price)
  values ('cccccccc-0000-0000-0000-0000000000c2', 'cccccccc-0000-0000-0000-0000000000c0', 'Tour con cupo', 50)
  on conflict (id) do nothing;
insert into allotment (id, organization_id, partner_id, product_id, allotment_type, seats, seats_used, status)
  values ('cccccccc-0000-0000-0000-0000000000c3', 'cccccccc-0000-0000-0000-0000000000c0',
          'cccccccc-0000-0000-0000-0000000000c1', 'cccccccc-0000-0000-0000-0000000000c2',
          'guaranteed', 10, 0, 'active')
  on conflict (id) do nothing;
update allotment set seats_used = 0 where id = 'cccccccc-0000-0000-0000-0000000000c3';
EOSQL
[ "$(id -u)" = "0" ] && chown postgres "$CUPO_SQL"
if ! psql_run -f "$CUPO_SQL" >/dev/null; then
  echo "✘ no se pudo preparar la carrera del cupo"; fail=1
else
  CUPO=cccccccc-0000-0000-0000-0000000000c3
  for i in $(seq 1 30); do
    "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d appdb -At -c "
      select public.claim_allotment_seats('$CUPO'::uuid, 1);" >/dev/null 2>&1 &
  done
  wait
  USADAS=$(psql_run -At -c "select seats_used from allotment where id = '$CUPO';" | tr -d '[:space:]')
  if [ "${USADAS:-0}" != "10" ]; then
    if [ "${USADAS:-0}" -gt 10 ] 2>/dev/null; then
      echo "✘ EL SOCIO PASÓ SU CONTRATO: $USADAS plazas consumidas de un cupo de 10"
    else
      echo "✘ el contador del cupo se perdió escrituras: $USADAS de 10 tras 30 ventas de una plaza"
    fi
    fail=1
  else
    echo "  30 ventas simultáneas del socio, cupo de 10, 10 plazas consumidas"
  fi
fi

echo "→ carrera: 30 ventas simultáneas de la última plaza"
CARRERA_SQL="$WORK/carrera.sql"
cat > "$CARRERA_SQL" <<'EOSQL'
insert into organizations (id, name, kind)
  values ('cccccccc-0000-0000-0000-00000000000f', 'Carrera F-001', 'tenant')
  on conflict (id) do nothing;
insert into product (id, organization_id, name, base_price)
  values ('cccccccc-0000-0000-0000-0000000000f1', 'cccccccc-0000-0000-0000-00000000000f', 'Tour', 50)
  on conflict (id) do nothing;
insert into departure (id, organization_id, product_id, departure_at, capacity, status)
  values ('cccccccc-0000-0000-0000-0000000000f2', 'cccccccc-0000-0000-0000-00000000000f',
          'cccccccc-0000-0000-0000-0000000000f1', now() + interval '10 days', 10, 'available')
  on conflict (id) do nothing;
insert into sales_order (id, organization_id, order_number, status)
  values ('cccccccc-0000-0000-0000-0000000000f3', 'cccccccc-0000-0000-0000-00000000000f', 'ORD-F001', 'pending_payment')
  on conflict (id) do nothing;
EOSQL
[ "$(id -u)" = "0" ] && chown postgres "$CARRERA_SQL"
if ! psql_run -f "$CARRERA_SQL" >/dev/null; then
  echo "✘ no se pudo preparar la carrera"; fail=1
else
  DEP=cccccccc-0000-0000-0000-0000000000f2
  for i in $(seq 1 30); do
    "${RUN[@]}" psql -h "$PGHOST" -p "$PGPORT" -d appdb -At -c "
      insert into booking (organization_id, departure_id, product_id, order_id, booking_number,
                           status, pax_total, total_amount, currency, booking_date)
      select 'cccccccc-0000-0000-0000-00000000000f','$DEP',
             'cccccccc-0000-0000-0000-0000000000f1','cccccccc-0000-0000-0000-0000000000f3',
             'F-$i','confirmed',1,100,'dop',now()
       where public.reserve_departure_capacity('$DEP'::uuid, 1) = true;" >/dev/null 2>&1 &
  done
  wait
  VENDIDAS=$(psql_run -At -c "select count(*) from booking where departure_id = '$DEP';" | tr -d '[:space:]')
  if [ "$VENDIDAS" != "10" ]; then
    if [ "${VENDIDAS:-0}" -gt 10 ] 2>/dev/null; then
      echo "✘ SOBREVENTA: $VENDIDAS reservas en una salida de 10 plazas"
    else
      echo "✘ el cerrojo dejó plazas sin vender: $VENDIDAS de 10"
    fi
    fail=1
  else
    echo "  30 ventas simultáneas, 10 plazas, 10 reservas"
  fi
fi

[ "$fail" = "0" ] && echo "✔ pruebas de base de datos en verde" || { echo "✘ fallaron pruebas de base de datos"; exit 1; }
