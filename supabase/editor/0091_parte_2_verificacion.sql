-- 0091 parte 2 de 2 — comprobación. Devuelve CINCO filas; todas tienen que
-- decir OK. Cualquier otra cosa significa que la parte 1 no llegó entera.

select 'la función existe' as comprueba,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'spend_partner_wallet'
       ) then 'OK' else 'FALTA' end as resultado
union all
-- Sin `security definer` la función corre con los permisos de quien llama y la
-- RLS la deja sin ver los movimientos: el saldo saldría en cero y TODO consumo
-- parecería un descubierto.
select 'corre como security definer',
       case when p.prosecdef then 'OK' else 'FALTA' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'spend_partner_wallet'
union all
-- Sin `search_path` fijo, un esquema en el camino del llamante puede colar otra
-- tabla `partner_wallet_movement` y el dinero se escribiría ahí.
select 'tiene search_path fijo',
       case when array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path%'
            then 'OK' else 'FALTA' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'spend_partner_wallet'
union all
-- EL CERROJO. Es lo único que serializa dos consumos del mismo socio: sin él,
-- la función compila, corre y vuelve a tener la carrera que vino a cerrar.
select 'bloquea al socio antes de sumar',
       case when pg_get_functiondef(p.oid) like '%for update%'
            then 'OK' else 'FALTA' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'spend_partner_wallet'
union all
-- Solo el servidor. `anon` es cualquiera en internet y `authenticated` es
-- cualquier usuario con sesión: los dos podrían gastarle el monedero a un socio.
select 'solo la llave de servicio puede ejecutarla',
       case when has_function_privilege('service_role', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute')
            then 'OK' else 'REVISAR' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'spend_partner_wallet';
