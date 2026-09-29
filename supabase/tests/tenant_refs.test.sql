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
  a_reg uuid; a_reg2 uuid; b_reg uuid; a_ses uuid;
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
  -- Un segundo mostrador de A: desde 0101 una caja no admite dos turnos
  -- abiertos, y esta prueba abre dos sesiones de A para comprobar OTRA cosa.
  insert into cash_register (organization_id, name) values (a_org, 'Mostrador A2') returning id into a_reg2;
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
      values (a_org, a_reg2, 'open', now(), a_org);
  exception when others then
    fallos := fallos || format('referenciar la propia empresa se rechaza: %s', sqlerrm);
  end;

  -- ── LA CAJA DE OTRA EMPRESA, NO ──────────────────────────────────────────
  begin
    insert into cash_session (organization_id, cash_register_id, status, opened_at)
      values (a_org, b_reg, 'open', now());
    fallos := fallos || 'una sesión de A se abrió en el mostrador de B'::text;
  exception when sqlstate '23514' then null;
  end;

  -- El socio de OTRA empresa tampoco.
  begin
    insert into cash_session (organization_id, cash_register_id, status, opened_at, partner_id)
      values (b_org, b_reg, 'open', now(), socio);
    fallos := fallos || 'la caja de B se abrió a nombre de un socio de A'::text;
  exception when sqlstate '23514' then null;
  end;

  if a_ses is null then
    -- Sin sesión de A no se pueden probar los movimientos; se apunta y se sigue.
    fallos := fallos || 'no se pudo abrir la sesión de A para seguir probando'::text;
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
    fallos := fallos || 'un asiento de A se escribió contra una cuenta de B'::text;
  exception when sqlstate '23514' then null;
  end;

  -- Y la venta de B tampoco.
  begin
    insert into ledger_entry (organization_id, ledger_account_id, order_id, posted_at, debit, credit)
      values (a_org, a_cuenta, b_ord, now(), 100, 0);
    fallos := fallos || 'un asiento de A citó la venta de B'::text;
  exception when sqlstate '23514' then null;
  end;

  -- ── EL SALDO REGALO ──────────────────────────────────────────────────────
  insert into gift_card (organization_id, code, initial_amount, balance, currency, customer_id)
    values (a_org, 'GC-A-1', 500, 500, 'usd', a_cli) returning id into a_tarjeta;

  begin
    insert into gift_card (organization_id, code, initial_amount, balance, currency, customer_id)
      values (a_org, 'GC-A-2', 500, 500, 'usd', b_cli);
    fallos := fallos || 'una tarjeta de A se emitió al cliente de B'::text;
  exception when sqlstate '23514' then null;
  end;

  -- Canjear contra la venta de otra empresa es dinero pasando de una a otra.
  begin
    insert into gift_card_movement (organization_id, gift_card_id, amount, movement_type, order_id)
      values (a_org, a_tarjeta, -50, 'redeem', b_ord);
    fallos := fallos || 'un saldo de A se canjeó contra la venta de B'::text;
  exception when sqlstate '23514' then null;
  end;

  -- ── LA REGLA DE COMISIÓN ─────────────────────────────────────────────────
  begin
    insert into commission_rule (organization_id, name, beneficiary_type, calc_type, value, product_id)
      values (a_org, 'Regla cruzada', 'seller', 'percentage', 10, b_prod);
    fallos := fallos || 'una regla de comisión de A se acotó al producto de B'::text;
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
      fallos := fallos || 'una sesión de A se MOVIÓ al mostrador de B por update'::text;
    exception when sqlstate '23514' then null;
    end;
  end if;

  begin
    update gift_card set customer_id = b_cli where organization_id = a_org and code = 'GC-A-1';
    fallos := fallos || 'una tarjeta de A se MOVIÓ al cliente de B por update'::text;
  exception when sqlstate '23514' then null;
  end;

  begin
    update commission_rule set product_id = b_prod
     where organization_id = a_org and name = 'Regla propia';
    fallos := fallos || 'una regla de A se MOVIÓ al producto de B por update'::text;
  exception when sqlstate '23514' then null;
  end;

  if array_length(fallos, 1) is null then
    raise notice 'tenant_refs: TODAS LAS ASERCIONES PASARON';
  else
    raise exception 'tenant_refs: %', array_to_string(fallos, ' | ');
  end if;
end $$;

-- ── LAS REFERENCIAS A UNA PERSONA (0102) ────────────────────────────────────
--
-- 0018 y 0095 cubrieron la venta y el dinero. 0102 cubre la otra familia: toda
-- referencia a una PERSONA —cliente, vendedor, proveedor— o a un DOCUMENTO
-- SOBRE UNA PERSONA —reserva, venta—. Ahí un cruce no es un número descuadrado:
-- es el expediente de alguien colgando de la empresa equivocada.
--
-- Se prueban las tres que más duelen y el camino de actualización, que es el
-- fácil de provocar desde la aplicación porque no hace falta crear nada.
do $$
declare
  fallos text[] := '{}';
  a_org uuid; b_org uuid;
  a_cli uuid; b_cli uuid;
  a_prov uuid; b_prov uuid;
  a_vend uuid; b_vend uuid;
  a_prod uuid; b_prod uuid;
  a_sal uuid; b_sal uuid;
  a_ord uuid; b_ord uuid;
  a_res uuid; b_res uuid;
  a_pickup uuid;
begin
  insert into organizations (name, kind) values ('Empresa A 0102', 'tenant') returning id into a_org;
  insert into organizations (name, kind) values ('Empresa B 0102', 'tenant') returning id into b_org;

  insert into customer (organization_id, first_name) values (a_org, 'Ana')  returning id into a_cli;
  insert into customer (organization_id, first_name) values (b_org, 'Beto') returning id into b_cli;
  insert into supplier (organization_id, name) values (a_org, 'Náutica A') returning id into a_prov;
  insert into supplier (organization_id, name) values (b_org, 'Náutica B') returning id into b_prov;
  insert into seller (organization_id, first_name) values (a_org, 'Vendedor A') returning id into a_vend;
  insert into seller (organization_id, first_name) values (b_org, 'Vendedor B') returning id into b_vend;
  insert into product (organization_id, name, base_price) values (a_org, 'Saona A', 100) returning id into a_prod;
  insert into product (organization_id, name, base_price) values (b_org, 'Saona B', 100) returning id into b_prod;
  insert into departure (organization_id, product_id, departure_at, capacity)
    values (a_org, a_prod, now() + interval '1 day', 20) returning id into a_sal;
  insert into departure (organization_id, product_id, departure_at, capacity)
    values (b_org, b_prod, now() + interval '1 day', 20) returning id into b_sal;
  insert into sales_order (organization_id, order_number, status)
    values (a_org, 'A-0102', 'pending_payment') returning id into a_ord;
  insert into sales_order (organization_id, order_number, status)
    values (b_org, 'B-0102', 'pending_payment') returning id into b_ord;
  insert into booking (organization_id, order_id, product_id, departure_id, booking_number, status)
    values (a_org, a_ord, a_prod, a_sal, 'A-R1', 'confirmed') returning id into a_res;
  insert into booking (organization_id, order_id, product_id, departure_id, booking_number, status)
    values (b_org, b_ord, b_prod, b_sal, 'B-R1', 'confirmed') returning id into b_res;

  -- ── LA MÁS CARA, Y NO ES DE DINERO ───────────────────────────────────────
  -- `supplier_response_token` es LA LLAVE del portal del proveedor: el enlace
  -- de un solo uso con el que alguien acepta o rechaza un servicio sin tener
  -- cuenta. Emitido a nombre de un proveedor de otra empresa, ese enlace abre
  -- el portal de otro. Es autenticación, no contabilidad.
  begin
    insert into supplier_response_token
      (organization_id, supplier_id, resource_kind, resource_id, token_hash, expires_at)
      values (a_org, b_prov, 'departure_resource', gen_random_uuid(), 'hash-cruzado-0102', now() + interval '1 day');
    fallos := fallos || 'A emitió una llave del portal a nombre de un proveedor de B'::text;
  exception when sqlstate '23514' then null;
  end;

  -- Y la del proveedor propio tiene que seguir entrando.
  begin
    insert into supplier_response_token
      (organization_id, supplier_id, resource_kind, resource_id, token_hash, expires_at)
      values (a_org, a_prov, 'departure_resource', gen_random_uuid(), 'hash-propio-0102', now() + interval '1 day');
  exception when others then
    fallos := fallos || format('la llave del portal del proveedor propio se rechaza: %s', sqlerrm);
  end;

  -- ── EL EXPEDIENTE DE UNA PERSONA ─────────────────────────────────────────
  -- Un caso de atención de A sobre el cliente de B mezcla a dos personas que no
  -- se conocen, y lo hace en una pantalla que despliega la ficha del cliente.
  begin
    insert into guest_case (organization_id, code, customer_id)
      values (a_org, 'CASO-0102-X', b_cli);
    fallos := fallos || 'un caso de atención de A se abrió sobre el cliente de B'::text;
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into guest_case (organization_id, code, customer_id) values (a_org, 'CASO-0102-OK', a_cli);
  exception when others then
    fallos := fallos || format('un caso sobre el cliente propio se rechaza: %s', sqlerrm);
  end;

  -- Una tarea de A colgada de la venta de B filtra el número de pedido ajeno.
  begin
    insert into task (organization_id, title, order_id) values (a_org, 'Tarea cruzada', b_ord);
    fallos := fallos || 'una tarea de A se colgó de la venta de B'::text;
  exception when sqlstate '23514' then null;
  end;

  -- Una lista de espera de A apuntando al vendedor de B le atribuye la venta.
  begin
    insert into waitlist_entry (organization_id, departure_id, seller_id)
      values (a_org, a_sal, b_vend);
    fallos := fallos || 'una lista de espera de A apuntó al vendedor de B'::text;
  exception when sqlstate '23514' then null;
  end;

  -- ── LO QUE 0018 YA CUBRÍA Y 0102 NO PUEDE HABER TIRADO ───────────────────
  --
  -- `pickup` YA tenía disparador desde 0018, con `booking_id`, `hotel_id` y
  -- `route_id`. El disparador se registra POR NOMBRE, así que añadir
  -- `supplier_id` en un `create trigger pickup_same_tenant_refs` nuevo SUSTITUYE
  -- al de 0018 en vez de sumarse: tres referencias perdidas a cambio de una
  -- ganada. Pasó, y el techo de abajo lo cazó por tres. Esta prueba lo caza por
  -- su nombre, que es más barato de leer que un número que no cuadra.
  begin
    insert into pickup (organization_id, booking_id) values (a_org, b_res);
    fallos := fallos || 'un recogido de A citó la reserva de B: 0102 tiró lo que 0018 cubría'::text;
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into pickup (organization_id, booking_id, supplier_id)
      values (a_org, a_res, b_prov);
    fallos := fallos || 'un recogido de A se asignó al proveedor de B'::text;
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into pickup (organization_id, booking_id, supplier_id)
      values (a_org, a_res, a_prov) returning id into a_pickup;
  exception when others then
    fallos := fallos || format('un recogido con reserva y proveedor propios se rechaza: %s', sqlerrm);
  end;

  -- ── Y EL CAMINO DE ACTUALIZACIÓN ─────────────────────────────────────────
  -- `before insert or update of <columnas>` dispara SIEMPRE en el insert, así
  -- que una lista de columnas recortada solo se nota moviendo una fila ya
  -- escrita.
  if a_pickup is not null then
    begin
      update pickup set supplier_id = b_prov where id = a_pickup;
      fallos := fallos || 'un recogido de A se MOVIÓ al proveedor de B por update'::text;
    exception when sqlstate '23514' then null;
    end;
  end if;

  begin
    update guest_case set customer_id = b_cli where organization_id = a_org and code = 'CASO-0102-OK';
    fallos := fallos || 'un caso de A se MOVIÓ al cliente de B por update'::text;
  exception when sqlstate '23514' then null;
  end;

  if array_length(fallos, 1) is null then
    raise notice 'tenant_refs 0102: las referencias a una persona no cruzan';
  else
    raise exception 'tenant_refs 0102: %', array_to_string(fallos, ' | ');
  end if;
end $$;

-- ── EL HUECO QUE QUEDA, MEDIDO ──────────────────────────────────────────────
--
-- DB-001 llevaba abierto sin un número al lado. Aquí queda medido: cuántas
-- claves foráneas de una columna hay entre dos tablas con inquilino, y cuántas
-- no tienen ninguna comprobación.
--
-- No se cubren todas a propósito —cada referencia comprobada cuesta una lectura
-- por fila insertada—, pero el hueco que queda es un número EXACTO y no un
-- tope. Un tope se cumple subiéndolo; un número exacto hay que moverlo en el
-- mismo cambio que mueve la realidad, en las dos direcciones.
do $$
declare
  /**
   * 141 → 105 con 0102.
   *
   * ES UN NÚMERO EXACTO, NO UN TOPE, y la diferencia importa: un tope se
   * cumple subiéndolo. La pérdida de `pickup` —0102 sustituyó por nombre el
   * disparador de 0018 y se llevó por delante tres comprobaciones— se cazó
   * porque el número dio 108 donde decía 105; con un tope de 141, que es el que
   * había, no habría dicho nada.
   *
   * Así que sube Y baja: si alguien cubre más referencias, este número baja con
   * el mismo cambio; si alguien añade una referencia sin cubrir, o le quita
   * columnas a un disparador que ya existía, sube y la prueba lo dice antes de
   * que llegue a producción.
   */
  MEDIDO constant integer := 105;
  /**
   * Y cuántas de todas ellas apuntan a una persona o a su expediente. También
   * exacto, y por el mismo motivo: un mínimo se cumple recortando la familia de
   * tablas padre hasta que el cero salga solo. Recortarla a `('customer')` no
   * rompía nada.
   */
  PERSONAS constant integer := 100;
  sin_cubrir integer;
  cuantas_personas integer;
  en_dinero text[];
  en_personas text[];
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

  if sin_cubrir > MEDIDO then
    raise exception 'tenant_refs: HAY % referencias sin cubrir y lo medido son %: alguien añadió una clave foránea entre tablas de inquilino sin comprobación, o le quitó columnas a un disparador que ya existía',
      sin_cubrir, MEDIDO;
  end if;
  if sin_cubrir < MEDIDO then
    raise exception 'tenant_refs: quedan % referencias sin cubrir y aquí dice %: se cubrieron más, baja el número en el mismo cambio para que siga midiendo',
      sin_cubrir, MEDIDO;
  end if;

  /**
   * ────────────────────────────────────────────────────────────────────────
   * Y TODA REFERENCIA A UNA PERSONA, TAMBIÉN CERO (0102).
   *
   * El techo de arriba admite huecos porque cada comprobación cuesta una
   * lectura por alta. Pero hacía falta un criterio escrito en vez de un gusto
   * para decidir cuáles se cubren, y es éste:
   *
   *   **Se comprueba toda referencia a una PERSONA —cliente, vendedor,
   *   proveedor— o a un DOCUMENTO SOBRE UNA PERSONA —reserva, venta—.**
   *
   * Porque ahí una referencia cruzada no es un dato raro: es el expediente de
   * alguien colgando de la empresa equivocada. Un caso de atención, una
   * encuesta, una tarea o una lista de espera apuntando al cliente de otra
   * operadora mezcla a dos personas que no se conocen, y en tablas que se
   * expanden en pantallas.
   *
   * Lo que queda fuera del techo refiere COSAS —almacén, mantenimiento,
   * turnos, activos—: un movimiento de stock mal apuntado es un número que
   * cuadrar, no la ficha de un tercero.
   *
   * Esta regla se comprueba sobre el CATÁLOGO, no sobre una lista escrita a
   * mano: una tabla nueva con una columna `customer_id` entra sola.
   */
  /**
   * LA LISTA DE PADRES NO PUEDE ENCOGER A ESCONDIDAS.
   *
   * Si la regla mira menos tablas padre, sigue dando cero y parece cumplida:
   * recortarla a `('customer')` no rompía nada. Así que además de exigir cero
   * sin cubrir, se cuenta CUÁNTAS referencias entra a mirar. Ese número sí se
   * mueve al recortar la familia, y está medido.
   */
  select count(*) into cuantas_personas
    from t_fks f
   where f.padre in ('customer', 'seller', 'supplier', 'booking', 'sales_order');

  if cuantas_personas <> PERSONAS then
    raise exception 'tenant_refs: la regla de personas mira % referencias y aquí dice %: o se le recortó la familia de tablas padre, o el esquema ganó una referencia a una persona y hay que cubrirla y mover este número',
      cuantas_personas, PERSONAS;
  end if;

  select array_agg(f.tabla || '.' || f.columna) into en_personas
    from t_fks f
   where f.padre in ('customer', 'seller', 'supplier', 'booking', 'sales_order')
     and not exists (select 1 from t_cub c where c.tabla = f.tabla and c.columna = f.columna);

  if en_personas is not null then
    raise exception 'tenant_refs: referencias a una PERSONA sin comprobar: %',
      array_to_string(en_personas, ', ');
  end if;

  -- Y en las tablas de dinero, entrada y descargo el hueco tiene que ser CERO.
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

  raise notice 'tenant_refs: % referencias sin cubrir (lo medido), % a una persona y todas comprobadas, cero en dinero, entrada y descargo',
    sin_cubrir, cuantas_personas;
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
