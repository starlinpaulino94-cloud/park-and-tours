-- 0078 · PARTE 2 — la comprobación, con filas legibles.
select
  'columna pricing_model'                                      as comprobacion,
  case when count(*) = 1 then 'OK' else 'FALTA' end            as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'organization_relationships'
  and column_name = 'pricing_model'

union all

select
  'relaciones por modelo',
  coalesce(string_agg(pricing_model || ': ' || n::text, ' · ' order by pricing_model), 'ninguna')
from (
  select pricing_model, count(*) as n from organization_relationships group by pricing_model
) r

union all

-- LA QUE HAY QUE MIRAR DESPUÉS DE DECLARAR ALGUNO COMO `net`.
--
-- Un socio a neto cuya comisión estándar sigue rellena no está mal configurado
-- —esa casilla deja de aplicarse—, pero es la señal de que alguien la rellenó
-- creyendo que se sumaban. Conviene revisarlo una vez.
select
  'socios a NETO con comisión estándar rellena',
  case when count(*) = 0 then 'OK — ninguno'
       else count(*)::text || ' socio(s): la comisión ya no se les aplica' end
from organization_relationships
where pricing_model = 'net'
  and coalesce(default_commission_pct, 0) > 0

union all

-- Y la que importa de verdad: comisiones YA generadas a socios que ahora están
-- declarados a neto. Son del pasado y no se tocan —reescribir el histórico es
-- peor—, pero hay que saber que existen antes de liquidar el mes.
select
  'comisiones ya generadas a socios ahora declarados NETO',
  case when count(*) = 0 then 'OK — ninguna'
       else count(*)::text || ' comisión(es) del pasado: revisar antes de liquidar' end
from commission c
join organization_relationships r on r.to_org_id = c.partner_id
where c.beneficiary_type = 'partner'
  and c.status not in ('cancelled', 'paid')
  and r.pricing_model = 'net';
