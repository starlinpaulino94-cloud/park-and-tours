-- ════════════════════════════════════════════════════════════════════════
-- 0095 · PARTE 3 — Verificación
--
-- Seis filas. Las seis tienen que decir OK.
--
-- La primera es la que importa: si FALTA, abrir una caja a nombre de un socio
-- sigue reventando con `column "organization_id" does not exist` en vez de
-- funcionar. La cuarta mide DB-001 y no puede empeorar.
-- ════════════════════════════════════════════════════════════════════════

with inq as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and exists (select 1 from pg_attribute a
                 where a.attrelid = c.oid and a.attname = 'organization_id'
                   and a.attnum > 0 and not a.attisdropped)
),
fks as (
  select hija.relname as tabla, att.attname as columna
  from pg_constraint k
  join inq hija on hija.oid = k.conrelid
  join inq padre on padre.oid = k.confrelid
  join pg_attribute att on att.attrelid = k.conrelid and att.attnum = k.conkey[1]
  where k.contype = 'f' and array_length(k.conkey, 1) = 1
    and att.attname <> 'organization_id'
),
cub as (
  select t.tabla, t.args[i] as columna
  from (
    select tgrelid::regclass::text as tabla,
           string_to_array(encode(tgargs, 'escape'), E'\\000') as args
    from pg_trigger tr join pg_proc p on p.oid = tr.tgfoid
    where p.proname = 'enforce_same_tenant_refs' and not tr.tgisinternal
  ) t, generate_subscripts(t.args, 1) i
  where i % 2 = 1 and coalesce(t.args[i], '') <> ''
),
sueltas as (
  select f.* from fks f
  where not exists (select 1 from cub c where c.tabla = f.tabla and c.columna = f.columna)
)

select 1 as orden, '1 · el disparador resuelve tenant_org_id' as comprueba,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'enforce_same_tenant_refs'
       and pg_get_functiondef(p.oid) like '%tenant_org_id%'
  ) then 'OK' else 'REVISAR' end as resultado,
  'si FALTA, abrir caja a nombre de un socio revienta con un error de esquema' as por_que

union all
select 2, '2 · sigue siendo security definer',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'enforce_same_tenant_refs'
       and p.prosecdef
       and array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path%'
  ) then 'OK' else 'REVISAR' end,
  'como invocador NO vería la fila padre y aprobaría cualquier referencia'

union all
select 3, '3 · los nueve disparadores de dinero están puestos',
  case when (
    select count(distinct tgrelid::regclass::text)
      from pg_trigger tr join pg_proc p on p.oid = tr.tgfoid
     where p.proname = 'enforce_same_tenant_refs' and not tr.tgisinternal
       and tgrelid::regclass::text in ('ledger_entry','cash_session','cash_register',
         'cash_movement','gift_card','gift_card_movement','access_ticket','waiver','commission_rule')
  ) = 9 then 'OK' else 'REVISAR' end,
  'si falta alguno, cruzar una referencia en esa tabla mueve dinero o admite a quien no es'

union all
select 4, '4 · cero referencias sueltas en dinero, entrada y descargo',
  case when (
    select count(*) from sueltas
     where tabla in ('ledger_entry','cash_session','cash_register','cash_movement',
       'gift_card','gift_card_movement','access_ticket','waiver','commission_rule')
  ) = 0 then 'OK' else 'REVISAR' end,
  'aquí el hueco tiene que ser CERO, no pequeño'

union all
select 5, '5 · el resto del hueco no creció (techo 141)',
  case when (select count(*) from sueltas) <= 141 then 'OK' else 'REVISAR' end,
  'si SIGUE subiendo, alguien añadió una clave foránea entre tablas de inquilino sin comprobación'

union all
select 6, '6 · cuántas quedan, para el registro',
  (select count(*)::text from sueltas),
  'DB-001 medido: 289 claves foráneas entre tablas de inquilino, y este es el resto sin cubrir'

order by orden;
