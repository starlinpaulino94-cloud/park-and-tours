-- ============================================================================
-- `citext`: lo que el doble en memoria NO puede afirmar (importador)
--
-- ───────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTA PRUEBA EXISTE
--
-- El registro de arreglos llevaba meses con un fallo abierto: «el cruce de
-- duplicados del importador no es insensible a mayúsculas, así que una ficha
-- guardada como `Laura@Example.com` se toma por nueva y el archivo la
-- duplica». Tenía su prueba afirmándolo, su explicación de por qué no se
-- arreglaba ahí, y hasta la ola que haría falta: «normalizar la columna en la
-- base —citext o un índice funcional—, o sea una migración».
--
-- `customer.email` ES `citext` DESDE 0004. El fallo no existía.
--
-- Lo que aquella prueba afirmaba era el comportamiento del DOBLE en memoria,
-- que comparaba con `===`. Un doble que se aparta del motor real no da falsos
-- verdes: da conclusiones falsas sobre el sistema, y esta se convirtió en deuda
-- técnica planificada contra un problema inexistente.
--
-- Por eso esto se comprueba AQUÍ, contra Postgres, que es el único sitio donde
-- `citext` significa algo.
--
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

do $$
declare
  fallos text[] := '{}';
  v_org uuid;
  v_tipo text;
begin
  insert into organizations (name, kind) values ('Citext cruce', 'tenant') returning id into v_org;
  insert into customer (organization_id, email, first_name) values (v_org, 'Laura@Example.com', 'Laura');
  insert into customer (organization_id, email, first_name) values (v_org, 'pedro@example.com', 'Pedro');

  -- ── El tipo, por su nombre ───────────────────────────────────────────────
  -- Si alguien la pasa a `text`, todo lo de abajo deja de ser verdad y el
  -- importador empieza a duplicar de verdad. Se comprueba antes que nada.
  select format_type(a.atttypid, a.atttypmod) into v_tipo
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'customer' and a.attname = 'email';
  if v_tipo is distinct from 'citext' then
    fallos := fallos || format('customer.email es %s y no citext: el importador duplicará fichas', v_tipo);
  end if;

  -- ── El `in` del importador, que es la forma exacta que usa ───────────────
  -- `resolveExisting` pregunta por lotes con `email in (...)`, todo en
  -- minúsculas porque `keyOf` las baja. Ésta es la consulta de verdad.
  if not exists (
    select 1 from customer
     where organization_id = v_org and email in ('laura@example.com')
  ) then
    fallos := fallos || 'el `in` en minúsculas no encuentra la ficha guardada con mayúsculas'::text;
  end if;

  -- Y la otra dirección: archivo en mayúsculas, ficha en minúsculas.
  if not exists (
    select 1 from customer
     where organization_id = v_org and email in ('PEDRO@EXAMPLE.COM')
  ) then
    fallos := fallos || 'el `in` en mayúsculas no encuentra la ficha guardada en minúsculas'::text;
  end if;

  -- ── Y lo que NO tiene que casar, para que esto no pase por no mirar ──────
  if exists (
    select 1 from customer
     where organization_id = v_org and email in ('otra@example.com')
  ) then
    fallos := fallos || 'casa con un correo que no está: la comparación no mira nada'::text;
  end if;

  -- `seller.email` y `organizations.slug` son las otras dos `citext`, y el
  -- doble de pruebas las trata igual: se comprueban aquí para que la lista de
  -- allí no se apoye en la memoria de nadie.
  --
  -- `relkind = 'r'` no es adorno: `pg_class` incluye los ÍNDICES, y un índice
  -- sobre una columna citext tiene a su vez una columna citext. Sin el filtro
  -- salían CINCO donde hay tres, y esta misma prueba lo cazó al escribirla.
  if (select count(*) from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_type t on t.oid = a.atttypid
       where n.nspname = 'public' and t.typname = 'citext' and a.attnum > 0
         and not a.attisdropped and c.relkind = 'r') <> 3 then
    fallos := fallos || format(
      'las columnas citext ya no son tres, son %s: revisa COLUMNAS_SIN_MAYUSCULAS en el doble',
      (select count(*) from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_type t on t.oid = a.atttypid
        where n.nspname = 'public' and t.typname = 'citext' and a.attnum > 0
          and not a.attisdropped and c.relkind = 'r'));
  end if;

  if array_length(fallos, 1) is null then
    raise notice 'citext_cruce: el cruce del importador NO duplica por mayúsculas';
  else
    raise exception 'citext_cruce: %', array_to_string(fallos, ' | ');
  end if;
end $$;

rollback;
