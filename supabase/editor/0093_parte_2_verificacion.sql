-- 0093 parte 2 de 2 — comprobación. Devuelve CINCO filas; todas tienen que
-- decir OK. Cualquier otra cosa significa que la parte 1 no llegó entera.
--
-- Y después: CIERRA SESIÓN Y VUELVE A ENTRAR. Estas filas dicen que el enganche
-- está bien; el token que tienes ahora mismo se emitió con el viejo.

with h as (
  select p.oid, p.prosecdef, coalesce(p.proconfig, '{}') as cfg,
         pg_get_functiondef(p.oid) as cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'custom_access_token_hook'
)
select 'el enganche existe' as comprueba,
       case when exists (select 1 from h) then 'OK' else 'FALTA' end as resultado
union all
-- Sin esto, el enganche corre con la RLS puesta, llama a `auth.uid()` —esquema
-- al que su rol no accede— y GoTrue devuelve 500 a TODO EL MUNDO. Es el fallo
-- que dejó a la operadora entera sin poder entrar.
select 'corre como security definer con search_path',
       case when prosecdef and array_to_string(cfg, ',') like '%search_path%'
            then 'OK' else 'FALTA' end
  from h
union all
-- Lo que 0084 perdió, uno: el selector de empresa.
select 'mira la empresa activa del selector',
       case when cuerpo like '%user_active_workspace%' then 'OK' else 'FALTA' end
  from h
union all
-- Lo que 0084 perdió, dos: la sucursal.
select 'manda branch_id',
       case when cuerpo like '%branch_id%' then 'OK' else 'FALTA' end
  from h
union all
-- Y lo que 0084 sí traía, que no se puede perder al arreglar lo otro.
select 'manda partner_id y supplier_id',
       case when cuerpo like '%partner_id%' and cuerpo like '%supplier_id%'
            then 'OK' else 'FALTA' end
  from h;
