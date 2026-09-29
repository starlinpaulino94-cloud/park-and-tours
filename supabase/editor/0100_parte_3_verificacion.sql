-- 0100 · parte 3 de 3 — verificación.
--
-- Cinco filas. Cada una dice qué pasa si NO está bien.

with fn as (
  select p.proname as nombre, pg_get_functiondef(p.oid) as src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_allotment_seats', 'release_allotment_seats')
)
select 'existe el reclamo del cupo' as comprobacion,
       case when exists (select 1 from fn where nombre = 'claim_allotment_seats')
            then 'ok' else 'FALTA: el cupo se sigue escribiendo desde la aplicación y se pierde' end as resultado
union all
select 'existe la devolución',
       case when exists (select 1 from fn where nombre = 'release_allotment_seats')
            then 'ok' else 'FALTA: dos cancelaciones a la vez devuelven una sola plaza' end
union all
-- Lo que hace que el reclamo sea atómico es que el tope va DENTRO del `update`.
-- Con un `select` previo vuelve la ventana entera.
select 'el tope se comprueba dentro de la escritura',
       case when (select src from fn where nombre = 'claim_allotment_seats')
                 like '%seats_released%>= p_pax%'
            then 'ok' else 'FALTA: el reclamo no comprueba el tope en la misma sentencia' end
union all
-- Las liberadas ya no son suyas: volvieron a la venta libre. Contarlas como
-- disponibles prometería dos veces la misma plaza.
select 'las plazas liberadas restan de lo que queda',
       case when (select src from fn where nombre = 'claim_allotment_seats')
                 like '%seats_released%'
            then 'ok' else 'FALTA: el cupo deja vender plazas que ya volvieron a la venta libre' end
union all
select 'quien vende puede llamarlas',
       case when (select count(*) from information_schema.role_routine_grants
                   where routine_schema = 'public'
                     and routine_name in ('claim_allotment_seats', 'release_allotment_seats')
                     and grantee in ('authenticated', 'service_role')) >= 2
            then 'ok' else 'FALTA: sin permiso, toda venta de socio con cupo fallará' end;
