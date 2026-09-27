-- ============================================================================
-- Referencias entre inquilinos (0018 + 0095).
--
-- Una clave foránea normal prueba que la fila padre EXISTE. No prueba que sea
-- de la misma empresa. Lo que se comprueba aquí no se puede comprobar sin base
-- de datos, porque los disparadores solo existen en la base:
--
--  · que abrir una caja a nombre de un socio FUNCIONE —llevaba roto desde 0081
--    con un error de esquema crudo—;
--  · que referenciar la propia empresa valga, aunque su `tenant_org_id` sea
--    nulo por ser la raíz;
--  · que cruzar una referencia en dinero, entrada o descargo se RECHACE;
--  · y que el hueco que queda sin cubrir no crezca.
--
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

do $$
declare
  fallos text[] := '{}';
  a_org uuid; b_org uuid; socio uuid;
  a_reg uuid; b_reg uuid; a_ses uuid;
  a_cli uuid; b_cli uuid;
  a_prod uuid; b_prod uuid;
  a_ord uuid; b_ord uuid;
  a_cuenta uuid; b_cuenta uuid;
  a_tarjeta uuid;
begin
  insert into organizations (name, kind) values ('Empresa A 0095', 'tenant') returning id into a_org;
  insert into organizations (name, kind) values ('Empresa B 0095', 'tenant') returning id into b_org;
  -- Un socio de A: su inquilino vive en `tenant_org_id`, no en una columna
  -- `organization_id` que `organizations` no tiene.
  insert into organizations (name, kind, tenant_org_id)
    values ('Socio de A', 'partner', a_org) returning id into socio;

  insert into cash_register (organization_id, name) values (a_org, 'Mostrador A') returning id into a_reg;
  insert into cash_register (organization_id, name) values (b_org, 'Mostrador B') returning id into b_reg;
  insert into customer (organization_id, first_name) values (a_org, 'Ana') returning id into a_cli;
  insert into customer (organization_id, first_name) values (b_org, 'Beto') returning id into b_cli;
  insert into product (organization_id, name, base_price) values (a_org, 'Saona', 100) returning id into a_prod;
  insert into product (organization_id, name, base_price) values (b_org, 'Buggy', 80) returning id into b_prod;
  insert into sales_order (organization_id, order_number, status)
    values (a_org, 'A-1', 'pending_payment') returning id into a_ord;
  insert into sales_order (organization_id, order_number, status)
    values (b_org, 'B-1', 'pending_payment') returning id into b_ord;

  -- ── LO QUE LLEVABA ROTO ──────────────────────────────────────────────────
  -- Abrir caja a nombre de un socio de A. Antes de 0095 esto no daba un
  -- rechazo: daba `column "organization_id" does not exist`.
  begin
    insert into cash_session (organization_id, cash_register_id, status, opened_at, partner_id)
      values (a_org, a_reg, 'open', now(), socio) returning id into a_ses;
  exception when others then
    fallos := fallos || format('la caja de un socio sigue rota: %s (%s)', sqlerrm, sqlstate);
  end;

  -- ── Y REFERENCIAR LA PROPIA EMPRESA TAMBIÉN VALE ─────────────────────────
  -- El nodo raíz tiene `tenant_org_id` nulo porque él mismo ES el inquilino.
  -- Tratar ese nulo como «no se sabe» habría rechazado esto.
  begin
    insert into cash_session (organization_id, cash_register_id, status, opened_at, partner_id)
      values (a_org, a_reg, 'open', now(), a_org);
  exception when others then
    fallos := fallos || format('referenciar la propia empresa se rechaza: %s', sqlerrm);
  end;

  -- ── LA CAJA DE OTRA EMPRESA, NO ──────────────────────────────────────────
  begin
    insert into cash_session (organization_id, cash_register_id, status, opened_at)
      values (a_org, b_reg, 'open', now());
    fallos := fallos || 'una sesión de A se abrió en el mostrador de B';
  exception when sqlstate '23514' then null;
  end;

  -- El socio de OTRA empresa tampoco.
  begin
    insert into cash_session (organization_id, cash_register_id, status, opened_at, partner_id)
      values (b_org, b_reg, 'open', now(), socio);
    fallos := fallos || 'la caja de B se abrió a nombre de un socio de A';
  exception when sqlstate '23514' then null;
  end;

  if a_ses is null then
    -- Sin sesión de A no se pueden probar los movimientos; se apunta y se sigue.
    fallos := fallos || 'no se pudo abrir la sesión de A para seguir probando';
  end if;

  -- ── EL ASIENTO CONTABLE ──────────────────────────────────────────────────
  insert into ledger_account (organization_id, code, name, account_type)
    values (a_org, '1100', 'Caja A', 'asset') returning id into a_cuenta;
  insert into ledger_account (organization_id, code, name, account_type)
    values (b_org, '1100', 'Caja B', 'asset') returning id into b_cuenta;

  -- La cuenta propia entra.
  begin
    insert into ledger_entry (organization_id, ledger_account_id, posted_at, debit, credit)
      values (a_org, a_cuenta, now(), 100, 0);
  exception when others then
    fallos := fallos || format('un asiento con la cuenta propia se rechaza: %s', sqlerrm);
  end;

  -- La cuenta de B, no. Es el peor cruce posible: descuadra los libros de las dos.
  begin
    insert into ledger_entry (organization_id, ledger_account_id, posted_at, debit, credit)
      values (a_org, b_cuenta, now(), 100, 0);
    fallos := fallos || 'un asiento de A se escribió contra una cuenta de B';
  exception when sqlstate '23514' then null;
  end;

  -- Y la venta de B tampoco.
  begin
    insert into ledger_entry (organization_id, ledger_account_id, order_id, posted_at, debit, credit)
      values (a_org, a_cuenta, b_ord, now(), 100, 0);
    fallos := fallos || 'un asiento de A citó la venta de B';
  exception when sqlstate '23514' then null;
  end;

  -- ── EL SALDO REGALO ──────────────────────────────────────────────────────
  insert into gift_card (organization_id, code, initial_amount, balance, currency, customer_id)
    values (a_org, 'GC-A-1', 500, 500, 'usd', a_cli) returning id into a_tarjeta;

  begin
    insert into gift_card (organization_id, code, initial_amount, balance, currency, customer_id)
      values (a_org, 'GC-A-2', 500, 500, 'usd', b_cli);
    fallos := fallos || 'una tarjeta de A se emitió al cliente de B';
  exception when sqlstate '23514' then null;
  end;

  -- Canjear contra la venta de otra empresa es dinero pasando de una a otra.
  begin
    insert into gift_card_movement (organization_id, gift_card_id, amount, movement_type, order_id)
      values (a_org, a_tarjeta, -50, 'redeem', b_ord);
    fallos := fallos || 'un saldo de A se canjeó contra la venta de B';
  exception when sqlstate '23514' then null;
  end;

  -- ── LA REGLA DE COMISIÓN ─────────────────────────────────────────────────
  begin
    insert into commission_rule (organization_id, name, beneficiary_type, calc_type, value, product_id)
      values (a_org, 'Regla cruzada', 'seller', 'percentage', 10, b_prod);
    fallos := fallos || 'una regla de comisión de A se acotó al producto de B';
  exception when sqlstate '23514' then null;
  end;

  -- La propia, sí.
  begin
    insert into commission_rule (organization_id, name, beneficiary_type, calc_type, value, product_id)
      values (a_org, 'Regla propia', 'seller', 'percentage', 10, a_prod);
  exception when others then
    fallos := fallos || format('una regla con producto propio se rechaza: %s', sqlerrm);
  end;

  -- ── Y EL CAMINO DE ACTUALIZACIÓN, QUE ES EL QUE SE OLVIDA ────────────────
  --
  -- `before insert or update of <columnas>` dispara SIEMPRE en el insert, así
  -- que una lista de columnas recortada no se nota probando solo inserciones:
  -- se nota cuando alguien MUEVE una fila ya escrita al mostrador, al vendedor o
  -- a la reserva de otra empresa. Es el cruce más fácil de provocar desde la
  -- aplicación, porque no hace falta crear nada.
  if a_ses is not null then
    begin
      update cash_session set cash_register_id = b_reg where id = a_ses;
      fallos := fallos || 'una sesión de A se MOVIÓ al mostrador de B por update';
    exception when sqlstate '23514' then null;
    end;
  end if;

  begin
    update gift_card set customer_id = b_cli where organization_id = a_org and code = 'GC-A-1';
    fallos := fallos || 'una tarjeta de A se MOVIÓ al cliente de B por update';
  exception when sqlstate '23514' then null;
  end;

  begin
    update commission_rule set product_id = b_prod
     where organization_id = a_org and name = 'Regla propia';
    fallos := fallos || 'una regla de A se MOVIÓ al producto de B por update';
  exception when sqlstate '23514' then null;
  end;

  if array_length(fallos, 1) is null then
    raise notice 'tenant_refs: TODAS LAS ASERCIONES PASARON';
  else
    raise exception 'tenant_refs: %', array_to_string(fallos, ' | ');
  end if;
end $$;

-- ── EL HUECO QUE QUEDA, MEDIDO Y CON TECHO ──────────────────────────────────
--
-- DB-001 llevaba abierto sin un número al lado. Aquí queda medido: cuántas
-- claves foráneas de una columna hay entre dos tablas con inquilino, y cuántas
-- no tienen ninguna comprobación.
--
-- No se cubren todas a propósito —cada referencia comprobada cuesta una lectura
-- por fila insertada—, pero el número se guarda como TECHO. Puede bajar; si
-- sube, alguien añadió una referencia sin cubrir y esta prueba lo dice antes de
-- que llegue a producción.
do $$
declare
  TECHO constant integer := 141;
  sin_cubrir integer;
  en_dinero text[];
begin
  create temp view t_inq as
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_attribute a
                   where a.attrelid = c.oid and a.attname = 'organization_id'
                     and a.attnum > 0 and not a.attisdropped);

  create temp view t_fks as
    select hija.relname as tabla, att.attname as columna, padre.relname as padre
    from pg_constraint k
    join t_inq hija on hija.oid = k.conrelid
    join t_inq padre on padre.oid = k.confrelid
    join pg_attribute att on att.attrelid = k.conrelid and att.attnum = k.conkey[1]
    where k.contype = 'f' and array_length(k.conkey, 1) = 1
      and att.attname <> 'organization_id';

  create temp view t_cub as
    with t as (
      select tgrelid::regclass::text as tabla,
             string_to_array(encode(tgargs, 'escape'), E'\\000') as args
      from pg_trigger tr join pg_proc p on p.oid = tr.tgfoid
      where p.proname = 'enforce_same_tenant_refs' and not tr.tgisinternal
    )
    select t.tabla, t.args[i] as columna
    from t, generate_subscripts(t.args, 1) i
    where i % 2 = 1 and coalesce(t.args[i], '') <> '';

  select count(*) into sin_cubrir
    from t_fks f
   where not exists (select 1 from t_cub c where c.tabla = f.tabla and c.columna = f.columna);

  if sin_cubrir > TECHO then
    raise exception 'tenant_refs: HAY % referencias sin cubrir y el techo es %: alguien añadió una clave foránea entre tablas de inquilino sin comprobación',
      sin_cubrir, TECHO;
  end if;

  -- Y en las tablas de dinero, entrada y descargo el hueco tiene que ser CERO.
  -- El techo de arriba admite que queden huecos; aquí no.
  select array_agg(f.tabla || '.' || f.columna) into en_dinero
    from t_fks f
   where f.tabla in ('ledger_entry', 'cash_session', 'cash_register', 'cash_movement',
                     'gift_card', 'gift_card_movement', 'access_ticket', 'waiver',
                     'commission_rule')
     and not exists (select 1 from t_cub c where c.tabla = f.tabla and c.columna = f.columna);

  if en_dinero is not null then
    raise exception 'tenant_refs: SIGUEN sin cubrir referencias de dinero/entrada/descargo: %',
      array_to_string(en_dinero, ', ');
  end if;

  raise notice 'tenant_refs: % referencias sin cubrir (techo %), cero en dinero, entrada y descargo',
    sin_cubrir, TECHO;
end $$;

-- ── Y el disparador sigue viendo lo que tiene que ver ───────────────────────
-- `security definer` es lo que le deja leer la fila padre aunque la RLS la
-- esconda del que escribe. Como invocador, un cruce se leería como «no existe»
-- en vez de como un cruce: el rechazo saldría igual, con el diagnóstico
-- equivocado, y quien investigue buscará una fila borrada que nunca se borró.
do $$
declare
  v_def boolean;
  v_path text;
begin
  select p.prosecdef, array_to_string(coalesce(p.proconfig, '{}'), ',')
    into v_def, v_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enforce_same_tenant_refs';

  if not coalesce(v_def, false) then
    raise exception 'tenant_refs: enforce_same_tenant_refs dejó de ser security definer';
  end if;
  if v_path not like '%search_path%' then
    raise exception 'tenant_refs: enforce_same_tenant_refs dejó de fijar search_path';
  end if;
  raise notice 'tenant_refs: el disparador sigue siendo security definer con search_path fijado';
end $$;

rollback;
