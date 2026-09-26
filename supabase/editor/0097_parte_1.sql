-- 0097 · parte 1 de 2 — una sola visita a la fila padre por referencia.
--
-- QUÉ ARREGLA. Insertar 2.000 reservas cuesta 1.521 ms con disparadores y
-- 77 ms sin ellos. Una reserva tiene diez referencias que validar, y el
-- disparador de 0095 gastaba DOS consultas en cada una —«¿existe?» y luego
-- «¿de quién es?»— sobre la misma fila y la misma clave. Fundidas en una, baja
-- a ~1.329 ms.
--
-- QUÉ NO CAMBIA. Los cinco rechazos de 0095 son los mismos, con el mismo
-- SQLSTATE. No hace falta tocar ningún disparador: sólo se reemplaza el cuerpo
-- de la función que todos ellos llaman.
--
-- REQUIERE 0095 APLICADA. Si 0095 no está, aplícala antes: esta parte sustituye
-- su función, no sus disparadores.

create or replace function app.enforce_same_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  idx integer := 0;
  ref_column text;
  ref_table regclass;
  ref_value text;
  scope_column text;
  parent_org uuid;
  existe boolean;
begin
  if new.organization_id is null then
    raise exception 'organization_id is required for tenant reference validation'
      using errcode = '23514';
  end if;

  while idx < array_length(tg_argv, 1) loop
    ref_column := tg_argv[idx];
    ref_table := tg_argv[idx + 1]::regclass;
    ref_value := to_jsonb(new)->>ref_column;

    if ref_value is not null and ref_value <> '' then
      /**
       * QUÉ COLUMNA DICE DE QUIÉN ES LA FILA PADRE.
       *
       * Antes se daba por hecho que era `organization_id`, y contra una tabla
       * que no la tiene el disparador reventaba con un error de esquema en vez
       * de validar. Se resuelve del catálogo: `organization_id` si está,
       * `tenant_org_id` si no — que es lo que apunta cada nodo a su raíz de
       * inquilino en `organizations` (0002) y lo que ya usan los RPC del panel.
       */
      select a.attname into scope_column
        from pg_attribute a
       where a.attrelid = ref_table
         and a.attname in ('organization_id', 'tenant_org_id')
         and a.attnum > 0 and not a.attisdropped
       order by case a.attname when 'organization_id' then 0 else 1 end
       limit 1;

      -- Sin ninguna de las dos no se puede validar, y callarse dejaría una
      -- comprobación que parece estar y no está: peor que no tenerla.
      if scope_column is null then
        raise exception 'No se puede validar el inquilino de %: no tiene organization_id ni tenant_org_id',
          ref_table::text
          using errcode = '23514';
      end if;

      /**
       * UNA SOLA VISITA A LA FILA PADRE.
       *
       * 0095 preguntaba dos veces por la misma fila: una para saber si existe y
       * otra para leer su inquilino. En una reserva son diez referencias (siete
       * del disparador principal más el cupo y el paquete), así que eran veinte
       * consultas por fila insertada en vez de diez.
       *
       * `into` deja los dos destinos en nulo cuando la consulta no devuelve
       * fila, así que `existe` distingue «no hay fila» (nulo) de «hay fila con
       * inquilino nulo» (cierto) sin perder ninguno de los dos errores que 0095
       * sabía dar. Se reinician a mano porque el bucle los reutiliza.
       */
      parent_org := null;
      existe := null;
      execute format('select %I, true from %s where id = $1', scope_column, ref_table)
        into parent_org, existe using ref_value::uuid;
      if existe is not true then
        raise exception 'Referenced row %.% does not exist', ref_table::text, ref_value
          using errcode = '23503';
      end if;

      /**
       * UNA RAÍZ NO TIENE INQUILINO PORQUE ELLA MISMA LO ES.
       *
       * `organizations.tenant_org_id` es nulo en el nodo raíz de una empresa. Su
       * inquilino es su propio `id`, así que referenciar la propia empresa tiene
       * que valer. Tratar ese nulo como «no se sabe» habría rechazado
       * referencias legítimas, y este disparador ya rompió una cosa por suponer
       * de más.
       */
      if parent_org is null and scope_column = 'tenant_org_id' then
        parent_org := ref_value::uuid;
      end if;

      -- Una fila de una tabla de inquilino SIN `organization_id` no es
      -- validable ni legítima: se rechaza en vez de dejarla pasar.
      if parent_org is null then
        raise exception 'Referenced row %.% has no tenant', ref_table::text, ref_value
          using errcode = '23514';
      end if;

      if parent_org <> new.organization_id then
        raise exception 'Cross-tenant reference rejected: %.% belongs to %, child belongs to %',
          ref_table::text, ref_value, parent_org, new.organization_id
          using errcode = '23514';
      end if;
    end if;

    idx := idx + 2;
  end loop;

  return new;
end;
$$;
