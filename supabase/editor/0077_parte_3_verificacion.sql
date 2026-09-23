-- 0077 · PARTE 3 — la comprobación, con filas legibles.
select
  'tabla partner_product'                                      as comprobacion,
  case when count(*) = 1 then 'OK' else 'FALTA' end            as resultado
from information_schema.tables
where table_schema = 'public' and table_name = 'partner_product'

union all

select
  'política por socio',
  case when count(*) = 1 then 'OK'
       else 'FALTA — el socio vería el contrato de sus competidores' end
from pg_policies
where schemaname = 'public' and tablename = 'partner_product'
  and policyname = 'tenant_select' and qual like '%can_read_partner%'

union all

select
  'los dos disparadores que evitan el apagón',
  case when count(*) = 2 then 'OK — producto nuevo y socio nuevo'
       else 'FALTAN — solo ' || count(*)::text end
from pg_trigger
where tgname in ('product_autoriza_socios','organizations_autoriza_catalogo')
  and not tgisinternal

union all

select
  'autorizaciones sembradas',
  count(*)::text || ' fila(s) para ' ||
  (select count(*)::text from organizations where kind = 'partner') || ' socio(s)'
from partner_product

union all

-- LA QUE IMPORTA. Si sale distinto de cero, esos tour centers no podrán vender
-- NADA en cuanto se despliegue el código.
select
  'socios ACTIVOS sin una sola autorización',
  case when count(*) = 0 then 'OK — ninguno'
       else count(*)::text || ' socio(s) NO PODRÁN VENDER NADA' end
from organizations o
where o.kind = 'partner'
  and coalesce(o.status, 'active') = 'active'
  and not exists (select 1 from partner_product pp where pp.partner_id = o.id);
