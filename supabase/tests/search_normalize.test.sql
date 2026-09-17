-- ============================================================================
-- 0062 — Buscar «jose perez» y encontrar a «José Pérez».
--
-- La prueba de TypeScript comprueba que las dos tablas de caracteres son la
-- misma cadena. Esto comprueba lo otro: que Postgres hace con esa cadena lo que
-- se espera, que la columna se calcula sola en las filas que YA EXISTÍAN, y que
-- se recalcula al editar la ficha.
--
-- Esa última es la que distingue una columna generada de una mantenida a mano:
-- una que se calcula al insertar y se olvida al actualizar deja fichas que se
-- encuentran por su nombre viejo y no por el nuevo.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/search_normalize.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set org '12120000-1212-1212-1212-121212121212'

insert into organizations (id, name, kind, currency) values
  (:'org', 'Operadora de búsqueda', 'tenant', 'usd');

do $$
begin
  -- El español, que es lo que se teclea todo el día.
  if app.search_normalize('José Pérez') <> 'jose perez' then
    raise exception 'los acentos del español no se quitan: %', app.search_normalize('José Pérez');
  end if;
  if app.search_normalize('Núñez') <> 'nunez' then
    raise exception 'la eñe no se normaliza: %', app.search_normalize('Núñez');
  end if;

  -- Y lo que llega de los pasaportes que pasan por una operadora dominicana.
  if app.search_normalize('MÜLLER') <> 'muller' then
    raise exception 'la diéresis alemana no se normaliza: %', app.search_normalize('MÜLLER');
  end if;
  if app.search_normalize('Gonçalves') <> 'goncalves' then
    raise exception 'la cedilla no se normaliza: %', app.search_normalize('Gonçalves');
  end if;

  -- Nulo no es una cadena vacía por accidente: es una decisión, porque la
  -- columna concatena campos que a menudo están vacíos.
  if app.search_normalize(null) <> '' then
    raise exception 'un nulo no se convierte en cadena vacía';
  end if;

  raise notice 'app.search_normalize: TODAS LAS ASERCIONES PASARON';
end $$;

do $$
declare
  org uuid := '12120000-1212-1212-1212-121212121212';
  ficha uuid;
begin
  insert into customer (organization_id, first_name, last_name, email, phone)
  values (org, 'José', 'Pérez Núñez', 'jose@ejemplo.do', '809-555-0101')
  returning id into ficha;

  -- Se calcula sola al insertar.
  if (select search_text from customer where id = ficha) not like '%jose%' then
    raise exception 'la columna generada no normalizó el nombre al insertar';
  end if;
  if (select search_text from customer where id = ficha) not like '%perez nunez%' then
    raise exception 'la columna generada no juntó nombre y apellido';
  end if;

  -- Y el correo y el teléfono entran en la misma cadena: buscar por cualquiera
  -- de los cinco campos encuentra la misma ficha.
  if (select search_text from customer where id = ficha) not like '%809-555-0101%' then
    raise exception 'el teléfono no entró en la columna de búsqueda';
  end if;

  -- SE RECALCULA AL EDITAR. Es lo que distingue una columna generada de una
  -- mantenida a mano: la de a mano se olvida en algún camino de escritura y
  -- deja fichas que se encuentran por su nombre viejo.
  update customer set last_name = 'Gonçalves' where id = ficha;
  if (select search_text from customer where id = ficha) not like '%goncalves%' then
    raise exception 'la columna no se recalculó al cambiar el apellido';
  end if;
  if (select search_text from customer where id = ficha) like '%perez%' then
    raise exception 'la columna conservó el apellido viejo';
  end if;

  -- NADIE LA ESCRIBE: Postgres rechaza cualquier intento, así que no hay forma
  -- de que un camino de escritura la deje mintiendo.
  begin
    update customer set search_text = 'lo que sea' where id = ficha;
    raise exception 'se admitió escribir a mano la columna generada';
  exception when generated_always then null;
  end;

  raise notice 'customer.search_text: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Las cuatro tablas la tienen, y su índice de trigramas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  tabla text;
begin
  foreach tabla in array array['customer', 'seller', 'product', 'supplier'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = tabla and column_name = 'search_text'
    ) then
      raise exception '% no tiene columna de búsqueda', tabla;
    end if;

    -- Sin el índice GIN la columna acierta pero cada búsqueda lee la tabla
    -- entera: funciona con dos mil clientes y no con veinte mil.
    if not exists (
      select 1 from pg_indexes
       where schemaname = 'public' and tablename = tabla and indexdef like '%gin_trgm_ops%'
    ) then
      raise exception '% no tiene índice de trigramas', tabla;
    end if;
  end loop;

  raise notice 'search_text en las cuatro tablas: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
