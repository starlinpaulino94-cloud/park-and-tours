-- ============================================================================
-- EL CUADERNO DEL EDITOR SQL, EJECUTADO.
--
-- `docs/operaciones/DESDE_EL_EDITOR_SQL.md` se le entrega a alguien que no
-- puede entrar al sistema, para que lo pegue en el editor de Supabase. O sea:
-- se ejecuta el peor día, por quien menos margen tiene para depurarlo, y contra
-- la base de producción.
--
-- Documentación que nadie ejecuta envejece en silencio. Una migración que
-- renombre una columna convierte cada bloque en un error de sintaxis, y el
-- primero en descubrirlo sería justo esa persona. Aquí se ejecutan de verdad,
-- contra el esquema de verdad, y se comprueba que hacen lo que el cuaderno
-- promete.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/sql_playbook.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set usuario  '51510000-0000-0000-0000-000000000001'
\set real     '51510000-6363-6363-6363-000000000001'
\set demo     '51510000-6363-6363-6363-000000000002'

insert into auth.users (id, email, encrypted_password, email_confirmed_at)
values (:'usuario', 'DemoPresentaciones@Ejemplo.Do', 'hash-que-no-se-mira', null);

insert into auth.identities (user_id, provider, provider_id, identity_data)
values (:'usuario', 'email', 'demopresentaciones@ejemplo.do', '{"sub":"x"}');

insert into organizations (id, name, slug, kind, currency, tenant_org_id, status)
values (:'real', 'Operadora Real', 'operadora-real-51', 'tenant', 'usd', :'real', 'active'),
       (:'demo', 'Operadora Real (Demostración)', 'operadora-real-51-demo', 'tenant', 'usd', :'demo', 'active');

insert into organization_memberships (user_id, organization_id, role, status, is_primary)
values (:'usuario', :'real', 'owner', 'active', true);

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 1 — ¿existe la cuenta, y en qué estado?
--
-- Lo que se comprueba aquí no es el resultado: es que las columnas EXISTEN y
-- que la búsqueda es insensible a mayúsculas. Un correo tecleado con mayúscula
-- que devolviera cero filas diría «esta cuenta no existe» de la cuenta que sí
-- existe — el peor diagnóstico posible, porque manda a crearla otra vez.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  select u.id, u.email, u.created_at, u.last_sign_in_at,
         (u.email_confirmed_at is not null) as email_confirmado,
         (u.encrypted_password is not null) as tiene_contrasena,
         (to_jsonb(u) ->> 'banned_until')   as bloqueada_hasta,
         (to_jsonb(u) ->> 'deleted_at')     as borrada,
         exists (select 1 from auth.identities i
                  where i.user_id = u.id and i.provider = 'email') as identidad_email
    into r
    from auth.users u
   where lower(u.email) = lower('demopresentaciones@ejemplo.do');

  if r.id is null then
    raise exception 'el bloque 1 no encuentra una cuenta que sí existe (¿comparación sensible a mayúsculas?)';
  end if;
  if r.email_confirmado then
    raise exception 'el bloque 1 dice que el email está confirmado y no lo está';
  end if;
  if not r.identidad_email then
    raise exception 'el bloque 1 no ve la identidad de correo';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 2 — a qué empresas pertenece, y dónde aterriza
--
-- La ★ tiene que coincidir con lo que hace el enganche del token, que es quien
-- decide de verdad. Si el cuaderno marcara una empresa y la sesión abriera otra,
-- sería peor que no decir nada.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare marcada uuid; elegida uuid;
begin
  select org.id into marcada
    from organization_memberships m
    join organizations org on org.id = m.organization_id
    join auth.users u      on u.id  = m.user_id
   where lower(u.email) = lower('demopresentaciones@ejemplo.do')
   order by m.is_primary desc, m.created_at
   limit 1;

  -- El mismo orden que `app.custom_access_token_hook`, sobre las activas.
  select org.id into elegida
    from organization_memberships m
    join organizations org on org.id = m.organization_id
   where m.user_id = (select id from auth.users where lower(email) = lower('demopresentaciones@ejemplo.do'))
     and m.status = 'active'
   order by m.is_primary desc, m.created_at asc
   limit 1;

  if marcada is distinct from elegida then
    raise exception 'la ★ del cuaderno no es la empresa que abriría la sesión';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EL BLOQUE 3 VA EN DOS SENTENCIAS Y EN ESE ORDEN
--
-- `memberships_one_primary` es un índice único PARCIAL, y los índices parciales
-- no son aplazables: no basta con que al final de la transacción haya un solo
-- primario, tiene que haberlo al final de CADA sentencia. Marcar el nuevo antes
-- de desmarcar el viejo revienta.
--
-- Esta comprobación es la que justifica el párrafo del cuaderno. Si alguien
-- «simplifica» el bloque juntando las dos sentencias, esto lo dice aquí y no en
-- el editor de alguien que ya estaba teniendo un mal día.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  begin
    insert into organization_memberships (user_id, organization_id, role, status, is_primary)
    values ((select id from auth.users where lower(email) = lower('demopresentaciones@ejemplo.do')),
            (select id from organizations where slug = 'operadora-real-51-demo'),
            'owner', 'active', true);
    raise exception 'un segundo primario debería haber chocado contra el índice, y no chocó';
  exception when unique_violation then
    null;  -- lo esperado
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 3 — dar la membresía, tal como lo escribe el cuaderno
-- ─────────────────────────────────────────────────────────────────────────────
with objetivo as (
  select
    (select id from auth.users    where lower(email) = lower('demopresentaciones@ejemplo.do')) as user_id,
    (select id from organizations where slug = 'operadora-real-51-demo')                       as org_id,
    'seller'::text as rol
)
update organization_memberships m
   set is_primary = false
  from objetivo o
 where m.user_id = o.user_id
   and m.organization_id is distinct from o.org_id
   and m.is_primary;

with objetivo as (
  select
    (select id from auth.users    where lower(email) = lower('demopresentaciones@ejemplo.do')) as user_id,
    (select id from organizations where slug = 'operadora-real-51-demo')                       as org_id,
    'seller'::text as rol
)
insert into organization_memberships (user_id, organization_id, role, status, is_primary)
select o.user_id, o.org_id, o.rol, 'active', true
  from objetivo o
 where o.user_id is not null and o.org_id is not null
on conflict (user_id, organization_id) do update
   set role = excluded.role, status = 'active', is_primary = true;

do $$
declare primarios int; rol_demo text; sigue_la_real int;
begin
  select count(*) into primarios
    from organization_memberships m join auth.users u on u.id = m.user_id
   where lower(u.email) = lower('demopresentaciones@ejemplo.do') and m.is_primary;
  if primarios <> 1 then
    raise exception 'tras el bloque 3 hay % primarios, no 1', primarios;
  end if;

  select m.role into rol_demo
    from organization_memberships m join organizations org on org.id = m.organization_id
   where org.slug = 'operadora-real-51-demo';
  if rol_demo <> 'seller' then
    raise exception 'el rol pedido no se aplicó: %', rol_demo;
  end if;

  -- La membresía de la empresa real NO se borra: sólo pierde la marca. Quitarla
  -- dejaría a la persona fuera de su propia operación por pedir entrar a la demo.
  select count(*) into sigue_la_real
    from organization_memberships m join organizations org on org.id = m.organization_id
   where org.slug = 'operadora-real-51' and m.status = 'active';
  if sigue_la_real <> 1 then
    raise exception 'el bloque 3 se llevó por delante la membresía de la empresa real';
  end if;
end $$;

-- Segunda pasada: el cuaderno dice que se puede repetir sin miedo.
with objetivo as (
  select
    (select id from auth.users    where lower(email) = lower('demopresentaciones@ejemplo.do')) as user_id,
    (select id from organizations where slug = 'operadora-real-51-demo')                       as org_id,
    'owner'::text as rol
)
insert into organization_memberships (user_id, organization_id, role, status, is_primary)
select o.user_id, o.org_id, o.rol, 'active', true
  from objetivo o
 where o.user_id is not null and o.org_id is not null
on conflict (user_id, organization_id) do update
   set role = excluded.role, status = 'active', is_primary = true;

do $$
declare n int; rol text;
begin
  select count(*) into n from organization_memberships m join auth.users u on u.id = m.user_id
   where lower(u.email) = lower('demopresentaciones@ejemplo.do');
  if n <> 2 then raise exception 'repetir el bloque 3 duplicó membresías: %', n; end if;
  select m.role into rol from organization_memberships m join organizations org on org.id = m.organization_id
   where org.slug = 'operadora-real-51-demo';
  if rol <> 'owner' then raise exception 'la segunda pasada no corrigió el rol: %', rol; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- EL SLUG QUE NO EXISTE NO HACE NADA
--
-- Es el error más fácil de cometer pegando el bloque: cambiar el correo y
-- olvidar el slug. El `where … is not null` tiene que convertirlo en cero filas
-- —no en una membresía apuntando a ninguna parte—.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare antes int; despues int;
begin
  select count(*) into antes from organization_memberships;

  with objetivo as (
    select
      (select id from auth.users    where lower(email) = lower('demopresentaciones@ejemplo.do')) as user_id,
      (select id from organizations where slug = 'esta-empresa-no-existe')                        as org_id,
      'owner'::text as rol
  )
  insert into organization_memberships (user_id, organization_id, role, status, is_primary)
  select o.user_id, o.org_id, o.rol, 'active', true
    from objetivo o
   where o.user_id is not null and o.org_id is not null
  on conflict (user_id, organization_id) do update
     set role = excluded.role, status = 'active', is_primary = true;

  select count(*) into despues from organization_memberships;
  if antes <> despues then
    raise exception 'un slug inexistente escribió algo (% → %)', antes, despues;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 4 — confirmar el email, y que repetirlo no mueva la fecha
--
-- El `coalesce` no es adorno: sin él, repetir el bloque reescribe la fecha de
-- confirmación cada vez y se pierde cuándo ocurrió de verdad.
-- ─────────────────────────────────────────────────────────────────────────────
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at         = now()
 where lower(email) = lower('demopresentaciones@ejemplo.do')
   and email_confirmed_at is null;

do $$
declare primera timestamptz; tocadas int;
begin
  select email_confirmed_at into primera from auth.users
   where lower(email) = lower('demopresentaciones@ejemplo.do');
  if primera is null then raise exception 'el bloque 4 no confirmó el email'; end if;

  /*
   * Lo que se mide es CUÁNTAS FILAS TOCA la segunda pasada, no si la fecha
   * cambió. Comparar la fecha aquí no probaría nada: `now()` devuelve el reloj
   * de la TRANSACCIÓN, y esta prueba entera es una sola, así que las dos
   * pasadas escribirían el mismo instante y la comparación pasaría también sin
   * el `and email_confirmed_at is null`. En el editor SQL cada bloque es su
   * propia transacción y las fechas SÍ diferirían — o sea que la aserción
   * cómoda es justo la que no sirve donde importa.
   */
  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
   where lower(email) = lower('demopresentaciones@ejemplo.do')
     and email_confirmed_at is null;
  get diagnostics tocadas = row_count;

  if tocadas <> 0 then
    raise exception 'repetir el bloque 4 vuelve a escribir la confirmación (% filas)', tocadas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOQUE 6 — encontrar la empresa de demostración
--
-- El cuaderno la busca por `metadata->>'demo'` o por el nombre. El sembrador
-- pone lo primero; lo segundo es el paracaídas para una demo creada a mano.
-- ─────────────────────────────────────────────────────────────────────────────
update organizations set metadata = jsonb_build_object('demo', true)
 where slug = 'operadora-real-51-demo';

do $$
declare n int;
begin
  select count(*) into n from organizations org
   where org.metadata ->> 'demo' = 'true' or org.name ilike '%demostraci%';
  if n < 1 then raise exception 'el bloque 6 no encuentra la empresa de demostración'; end if;

  -- Y los recuentos por empresa tienen que poder pedirse: si una de estas
  -- tablas cambiara de nombre, el bloque reventaría en el editor de alguien.
  perform (select count(*) from product  p where p.organization_id = org.id)
        + (select count(*) from booking  b where b.organization_id = org.id)
        + (select count(*) from customer c where c.organization_id = org.id)
     from organizations org where org.slug = 'operadora-real-51-demo';
end $$;

\echo '✔ cuaderno del editor SQL: los bloques corren y hacen lo que prometen'
rollback;
