-- 0095 — Las referencias cruzadas donde más daño hacen, y el arreglo de un
--        disparador que rompía la caja de un socio.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PRIMERO: UN FALLO QUE LLEVA AHÍ DESDE 0081
--
-- `cash_session_same_tenant` se creó con el argumento `partner_id organizations`.
-- El disparador genérico de 0018 valida una referencia leyendo
-- `organization_id` de la tabla padre… y `organizations` NO TIENE esa columna.
--
-- Así que abrir una caja a nombre de un socio —que es exactamente para lo que
-- existe 0081— no falla con un mensaje: falla con un error de esquema crudo,
-- `column "organization_id" does not exist` (42703). Comprobado contra
-- Postgres 16:
--
--     SIN SOCIO: entra
--     CON SOCIO: FALLA -> column "organization_id" does not exist (42703)
--
-- No lo cazó ninguna prueba porque ninguna insertaba una sesión de caja con
-- socio contra una base de verdad. Es el precio de probar una capa por encima:
-- el disparador solo existe en la base, y solo la base puede decir si funciona.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ TENANT ES EL DE UNA FILA
--
-- La respuesta no siempre está en `organization_id`. En `organizations` está en
-- `tenant_org_id`, que es lo que «apunta cada nodo a su raíz de inquilino»
-- (0002) y lo que ya usan los RPC del panel para acotar un socio
-- (`o.tenant_org_id = p_org_id`, 0023/0024).
--
-- Así que el disparador deja de suponer el nombre de la columna y lo RESUELVE:
-- `organization_id` si existe, `tenant_org_id` si no. Una regla, dicha, y
-- `organizations` pasa a ser un padre válido en vez de una bomba.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Y SEGUNDO: DB-001, MEDIDO
--
-- «Ninguna clave foránea es compuesta `(organization_id, id)`» llevaba abierto
-- desde la primera auditoría sin un número al lado. Medido ahora contra el
-- esquema real: **289** claves foráneas de una columna entre dos tablas con
-- inquilino, de las cuales **174 no tenían ninguna comprobación**.
--
-- No se cubren las 174. Cada referencia comprobada cuesta una lectura por fila
-- insertada, y ponerlas todas encarecería el camino de la venta para proteger
-- tablas donde cruzar una referencia solo ensucia un informe. Se cubren las
-- **33** en las que cruzarla mueve dinero, admite a alguien o da por firmado un
-- documento que no se firmó:
--
--   · `ledger_entry` (7) — el asiento contable. Una línea de la empresa A
--     citando el pago de la B corrompe los libros de LAS DOS, y la contabilidad
--     es justo donde vive el «fíate de los números».
--   · `cash_session`, `cash_register`, `cash_movement` — un arqueo atribuido al
--     mostrador o al vendedor de otra empresa.
--   · `gift_card`, `gift_card_movement` — un saldo canjeado contra la venta de
--     otra empresa es dinero pasando de una a otra.
--   · `access_ticket` — admitir a alguien con la reserva de otro.
--   · `waiver` — el descargo de responsabilidad. Atado a la reserva de otra
--     empresa, la operadora cree tener una firma que no tiene.
--   · `commission_rule` — una regla acotada al producto o al vendedor de otra
--     empresa: se le paga al que no es.
--
-- Lo que queda sin cubrir se mide en la prueba `tenant_refs.test.sql`, que
-- guarda el número como techo: puede bajar, no subir.

-- ── El disparador genérico, arreglado ───────────────────────────────────────
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

      execute format('select exists(select 1 from %s where id = $1)', ref_table)
        into existe using ref_value::uuid;
      if not existe then
        raise exception 'Referenced row %.% does not exist', ref_table::text, ref_value
          using errcode = '23503';
      end if;

      execute format('select %I from %s where id = $1', scope_column, ref_table)
        into parent_org using ref_value::uuid;

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

-- ── Las 33 referencias que importan ─────────────────────────────────────────
-- Un disparador por tabla, como estableció 0018: dos disparadores solapados
-- sobre la misma tabla harían el doble de lecturas y el día que se toque uno el
-- otro se queda atrás.

-- El asiento contable. Siete referencias, y el peor sitio posible para cruzar
-- una: una línea de la empresa A citando el pago de la B descuadra las dos.
drop trigger if exists ledger_entry_cash_session_same_tenant on ledger_entry;
drop trigger if exists ledger_entry_same_tenant_refs on ledger_entry;
create trigger ledger_entry_same_tenant_refs
before insert or update of organization_id, cash_session_id, expense_id,
  ledger_account_id, order_id, payable_id, payment_id, receivable_id, settlement_id
on ledger_entry
for each row execute function app.enforce_same_tenant_refs(
  'cash_session_id', 'cash_session',
  'expense_id', 'expense',
  'ledger_account_id', 'ledger_account',
  'order_id', 'sales_order',
  'payable_id', 'payable',
  'payment_id', 'payment',
  'receivable_id', 'receivable',
  'settlement_id', 'settlement'
);

-- La caja. `partner_id` apunta a `organizations`, y es la referencia que
-- reventaba: ahora se valida por `tenant_org_id`, que es donde vive la respuesta.
drop trigger if exists cash_session_same_tenant on cash_session;
drop trigger if exists cash_session_same_tenant_refs on cash_session;
create trigger cash_session_same_tenant_refs
before insert or update of organization_id, partner_id, branch_id, cash_register_id, seller_id
on cash_session
for each row execute function app.enforce_same_tenant_refs(
  'partner_id', 'organizations',
  'branch_id', 'branch',
  'cash_register_id', 'cash_register',
  'seller_id', 'seller'
);

drop trigger if exists cash_register_same_tenant_refs on cash_register;
create trigger cash_register_same_tenant_refs
before insert or update of organization_id, branch_id, seller_id
on cash_register
for each row execute function app.enforce_same_tenant_refs(
  'branch_id', 'branch',
  'seller_id', 'seller'
);

-- El movimiento de caja ya tenía dos referencias cubiertas desde 0018; se
-- rehace con las cuatro para no dejar dos disparadores en la misma tabla.
drop trigger if exists cash_movement_same_tenant_refs on cash_movement;
create trigger cash_movement_same_tenant_refs
before insert or update of organization_id, cash_session_id, payment_id, commission_id, seller_id
on cash_movement
for each row execute function app.enforce_same_tenant_refs(
  'cash_session_id', 'cash_session',
  'payment_id', 'payment',
  'commission_id', 'commission',
  'seller_id', 'seller'
);

-- El saldo regalo: canjearlo contra la venta de otra empresa es dinero pasando
-- de una a otra sin que nadie lo apunte.
drop trigger if exists gift_card_same_tenant_refs on gift_card;
create trigger gift_card_same_tenant_refs
before insert or update of organization_id, customer_id, order_id, product_id
on gift_card
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'order_id', 'sales_order',
  'product_id', 'product'
);

drop trigger if exists gift_card_movement_same_tenant_refs on gift_card_movement;
create trigger gift_card_movement_same_tenant_refs
before insert or update of organization_id, gift_card_id, order_id
on gift_card_movement
for each row execute function app.enforce_same_tenant_refs(
  'gift_card_id', 'gift_card',
  'order_id', 'sales_order'
);

-- La entrada. Cruzar aquí una referencia es admitir a alguien con la reserva de
-- otro — y en la puerta nadie va a mirar de qué empresa era.
drop trigger if exists access_ticket_same_tenant_refs on access_ticket;
create trigger access_ticket_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id, membership_id,
  order_id, participant_id, product_id
on access_ticket
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer',
  'membership_id', 'membership',
  'order_id', 'sales_order',
  'participant_id', 'participant',
  'product_id', 'product'
);

-- El descargo de responsabilidad. Atado a la reserva de otra empresa, la
-- operadora cree tener una firma que no tiene — y eso se descubre el día del
-- accidente.
drop trigger if exists waiver_same_tenant_refs on waiver;
create trigger waiver_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id,
  participant_id, product_id, waiver_template_id
on waiver
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer',
  'participant_id', 'participant',
  'product_id', 'product',
  'waiver_template_id', 'waiver_template'
);

-- La regla de comisión: acotada al producto o al vendedor de otra empresa, se le
-- paga al que no es.
drop trigger if exists commission_rule_same_tenant_refs on commission_rule;
create trigger commission_rule_same_tenant_refs
before insert or update of organization_id, category_id, product_id, seller_id
on commission_rule
for each row execute function app.enforce_same_tenant_refs(
  'category_id', 'product_category',
  'product_id', 'product',
  'seller_id', 'seller'
);

-- ── Y la comprobación de que el arreglo del disparador quedó puesto ─────────
-- Una función que sigue suponiendo `organization_id` no falla al crearse: falla
-- el día que alguien abre una caja de socio, con un error de esquema crudo.
do $$
declare
  v_def boolean;
  v_path text;
  v_cuerpo text;
begin
  select p.prosecdef, array_to_string(coalesce(p.proconfig, '{}'), ','), pg_get_functiondef(p.oid)
    into v_def, v_path, v_cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enforce_same_tenant_refs';

  if v_cuerpo is null then
    raise exception '0095: app.enforce_same_tenant_refs no existe';
  end if;
  if v_cuerpo not like '%tenant_org_id%' then
    raise exception '0095: enforce_same_tenant_refs no resuelve tenant_org_id: la caja de un socio seguiría rota';
  end if;
  /**
   * Y `security definer` es lo que le deja VER la fila padre aunque la RLS la
   * esconda del que escribe. Como invocador, una referencia a otra empresa se
   * leería como «no existe» —un 23503— en vez de como lo que es: un cruce de
   * inquilinos. El rechazo seguiría saliendo, pero con el diagnóstico
   * equivocado, y el día que alguien investigue un cruce buscará una fila
   * borrada que nunca se borró.
   */
  if not coalesce(v_def, false) then
    raise exception '0095: enforce_same_tenant_refs no quedó security definer: un cruce se leería como referencia inexistente';
  end if;
  if v_path not like '%search_path%' then
    raise exception '0095: enforce_same_tenant_refs no fijó search_path';
  end if;
  raise notice '0095: referencias de inquilino cubiertas en las tablas de dinero, entrada y descargo';
end $$;
