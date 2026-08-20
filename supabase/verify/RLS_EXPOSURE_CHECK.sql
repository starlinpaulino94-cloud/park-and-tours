-- ============================================================================
-- VERIFICACIÓN DE EXPOSICIÓN — solo lectura, no modifica nada.
-- Pégalo en: Supabase Dashboard → SQL Editor → Run
-- ============================================================================

-- 1) ¿Cuántas tablas están expuestas por PostgREST SIN RLS?
--    Cualquier fila aquí es una tabla que se puede leer/escribir con la anon key.
select
  c.relname                                   as tabla,
  c.relrowsecurity                            as rls_activa,
  has_table_privilege('anon',          c.oid, 'SELECT') as anon_select,
  has_table_privilege('anon',          c.oid, 'INSERT') as anon_insert,
  has_table_privilege('anon',          c.oid, 'UPDATE') as anon_update,
  has_table_privilege('anon',          c.oid, 'DELETE') as anon_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false
order by anon_select desc, c.relname;

-- 2) Resumen de una línea.
select
  count(*) filter (where relrowsecurity)                                    as con_rls,
  count(*) filter (where not relrowsecurity)                                as sin_rls,
  count(*) filter (where not relrowsecurity
                     and has_table_privilege('anon', c.oid, 'SELECT'))        as expuestas_a_anon
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- 3) ¿Hay DATOS reales dentro? (si todo es 0, la exposición es de esquema vacío)
select 'customer' t, count(*) from customer
union all select 'booking',     count(*) from booking
union all select 'payment',     count(*) from payment
union all select 'participant', count(*) from participant
union all select 'commission',  count(*) from commission
union all select 'ledger_entry',count(*) from ledger_entry
union all select 'organizations', count(*) from organizations
order by 2 desc;

-- 4) Funciones SECURITY DEFINER ejecutables por anon (SEC-002).
select p.proname, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede_ejecutar
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','app')
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.prosecdef desc, p.proname;
