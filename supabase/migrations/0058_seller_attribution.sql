-- ═══════════════════════════════════════════════════════════════════════════
-- 0058 — QUIÉN TRAJO AL CLIENTE
--
-- POR QUÉ
--
-- Hasta aquí, el vendedor de una venta es el que la operadora escogió en un
-- desplegable al teclearla. Eso funciona cuando vende el equipo propio y se
-- rompe justo donde está el negocio de una operadora dominicana: el conserje
-- del hotel, el taxista de la parada, el promotor de la playa. Esa gente no
-- teclea la venta —ni tiene cuenta, ni la quiere— y aun así es quien trae al
-- cliente.
--
-- Hoy no hay forma de responder dos preguntas que se hacen todas las semanas:
--
--   «¿Cuántos clientes me trajo el QR de Bahía Príncipe este mes?»
--   «Esta venta la cerró el mostrador, pero ¿de quién era el cliente?»
--
-- La primera no se puede contestar porque no se guarda. La segunda se contesta
-- hoy por memoria, que es como se pierden las comisiones y como se pierden los
-- conserjes.
--
-- EL HECHO Y LA POLÍTICA SON COSAS DISTINTAS
--
-- Esta migración guarda HECHOS: «esta persona entró por el enlace de este
-- vendedor, este día, por este canal». Un hecho no se edita ni se borra —hay
-- un disparador que lo impide, más abajo—, porque si se pudiera reescribir
-- dejaría de servir para pagar dinero.
--
-- A quién le toca la comisión NO se decide al guardar el hecho: se decide al
-- vender, leyendo el histórico con la política que la empresa tenga puesta
-- (primera, última, o la de quien tomó la reserva). La consecuencia importa:
-- cambiar la política mañana NO reescribe el pasado, y el embudo —cuántas
-- visitas, cuántos registros, cuántas reservas, cuántas compras por vendedor—
-- se responde agrupando filas en vez de reconstruyéndolo de memoria.
--
-- POR QUÉ EL SLUG ES ÚNICO EN TODO EL SISTEMA, NO POR EMPRESA
--
-- El enlace va impreso en un QR pegado en el mostrador de un hotel:
-- `…/e/RAF00125`. Quien lo escanea no ha dicho todavía de qué empresa es
-- cliente —ni tiene por qué—, así que el slug tiene que resolver la empresa él
-- solo. Un slug repetido entre dos inquilinos mandaría al visitante a la
-- operadora equivocada.
--
-- LO QUE NO SE AÑADE, Y POR QUÉ
--
-- MEMBEGO tiene además un catálogo de canales de venta por empresa. Aquí
-- `sales_channel` ya es un enum que usan `sales_order`, `booking`, `price_rule`
-- y `commission_rule`. Un segundo vocabulario de canales al lado haría que
-- «por canal» significara dos cosas distintas según el informe, y eso no se
-- arregla después. Lo que la operadora quiere de verdad —«esto vino del puesto
-- del muelle»— lo da el nombre del enlace, que es texto libre suyo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── catálogo de tipos de vendedor ──────────────────────────────────────────
--
-- Existe por una razón concreta y no por completismo: la regla de comisión y la
-- meta comercial se quieren fijar POR TIPO («todos los hoteles cobran 15 %»),
-- y sin catálogo eso sería texto tecleado a mano en cada regla, donde «Hotel»
-- y «hotel» serían dos tipos distintos y una de las dos reglas no pagaría.
create table if not exists seller_type (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  description text,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, name)
);
create index if not exists seller_type_org_idx on seller_type (organization_id, status);

drop trigger if exists seller_type_touch on seller_type;
create trigger seller_type_touch before update on seller_type
for each row execute function app.touch_updated_at();

alter table seller
  add column if not exists seller_type_id uuid references seller_type(id) on delete set null;

create index if not exists seller_seller_type_idx
  on seller (organization_id, seller_type_id) where seller_type_id is not null;

drop trigger if exists seller_type_same_tenant on seller;
create trigger seller_type_same_tenant
before insert or update of organization_id, seller_type_id on seller
for each row execute function app.enforce_same_tenant_refs('seller_type_id', 'seller_type');

-- ── el enlace del vendedor ─────────────────────────────────────────────────
create table if not exists seller_link (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  seller_id   uuid not null references seller(id) on delete cascade,
  -- Único en todo el sistema: ver la cabecera.
  slug        text not null,
  -- Lo que la operadora escribe para reconocerlo: «QR mostrador Macao».
  name        text,
  -- Canal declarado, para distinguir el QR impreso del enlace de WhatsApp.
  channel     text not null default 'link'
                check (channel in ('qr','link','whatsapp','social','email','print')),
  -- Un enlace puede llevar directo a un producto en vez de a la portada.
  product_id  uuid references product(id) on delete set null,
  -- Campaña libre, para separar «Macao agosto» de «Macao septiembre».
  campaign    text,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists seller_link_slug_key on seller_link (lower(slug));
create index if not exists seller_link_seller_idx on seller_link (organization_id, seller_id, status);

drop trigger if exists seller_link_touch on seller_link;
create trigger seller_link_touch before update on seller_link
for each row execute function app.touch_updated_at();

drop trigger if exists seller_link_same_tenant on seller_link;
create trigger seller_link_same_tenant
before insert or update of organization_id, seller_id, product_id on seller_link
for each row execute function app.enforce_same_tenant_refs(
  'seller_id', 'seller',
  'product_id', 'product'
);

-- ── el embudo, fila por fila ───────────────────────────────────────────────
--
-- Cada paso deja una fila. `visit` la deja alguien que todavía no es nadie: no
-- hay cliente, solo la cookie del navegador. Al registrarse, esa cookie enlaza
-- las visitas anónimas con su ficha; por eso `visitor_id` se guarda siempre y
-- no solo mientras el visitante es anónimo.
create table if not exists seller_attribution (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  seller_id   uuid not null references seller(id) on delete cascade,
  link_id     uuid references seller_link(id) on delete set null,
  -- Ficha comercial cuando ya se conoce. Una visita anónima aún no la tiene.
  customer_id uuid references customer(id) on delete set null,
  -- Cookie del visitante: lo único que hay antes de que el cliente exista.
  visitor_id  text,
  stage       text not null check (stage in ('visit','signup','booking','purchase')),
  channel     text,
  -- A dónde entró, para saber qué QR funciona y cuál no.
  landing     text,
  campaign    text,
  order_id    uuid references sales_order(id) on delete set null,
  booking_id  uuid references booking(id) on delete set null,
  -- Sin updated_at a propósito: un hecho no se actualiza.
  created_at  timestamptz not null default now()
);

create index if not exists seller_attribution_funnel_idx
  on seller_attribution (organization_id, seller_id, stage, created_at desc);
create index if not exists seller_attribution_customer_idx
  on seller_attribution (organization_id, customer_id) where customer_id is not null;
create index if not exists seller_attribution_visitor_idx
  on seller_attribution (organization_id, visitor_id) where visitor_id is not null;
create index if not exists seller_attribution_link_idx
  on seller_attribution (link_id) where link_id is not null;

drop trigger if exists seller_attribution_same_tenant on seller_attribution;
create trigger seller_attribution_same_tenant
before insert or update of organization_id, seller_id, link_id, customer_id, order_id, booking_id
on seller_attribution
for each row execute function app.enforce_same_tenant_refs(
  'seller_id', 'seller',
  'link_id', 'seller_link',
  'customer_id', 'customer',
  'order_id', 'sales_order',
  'booking_id', 'booking'
);

-- ── la inmutabilidad, escrita donde no se puede olvidar ────────────────────
--
-- «Esta tabla no se edita» en un comentario es una intención; en un disparador
-- es un hecho. La diferencia importa el día que alguien arregle un embudo a
-- mano desde el editor de SQL para que le cuadre una comisión.
--
-- La única excepción es enlazar una visita anónima con la ficha que nace
-- después: eso no reescribe el hecho, lo completa. Por eso se permite pasar
-- `customer_id` de nulo a un valor, y nada más.
create or replace function app.seller_attribution_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'seller_attribution es un histórico: no se borra (id=%)', old.id
      using errcode = '23514';
  end if;

  if old.organization_id is distinct from new.organization_id
     or old.seller_id  is distinct from new.seller_id
     or old.link_id    is distinct from new.link_id
     or old.stage      is distinct from new.stage
     or old.channel    is distinct from new.channel
     or old.landing    is distinct from new.landing
     or old.campaign   is distinct from new.campaign
     or old.visitor_id is distinct from new.visitor_id
     or old.order_id   is distinct from new.order_id
     or old.booking_id is distinct from new.booking_id
     or old.created_at is distinct from new.created_at then
    raise exception 'seller_attribution es un histórico: solo se puede completar customer_id (id=%)', old.id
      using errcode = '23514';
  end if;

  if old.customer_id is not null and old.customer_id is distinct from new.customer_id then
    raise exception 'seller_attribution: el cliente de un hecho ya escrito no se cambia (id=%)', old.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists seller_attribution_append_only on seller_attribution;
create trigger seller_attribution_append_only
before update or delete on seller_attribution
for each row execute function app.seller_attribution_append_only();

-- ── la atribución que ganó, congelada en la venta ──────────────────────────
--
-- `sales_order.seller_id` ya dice a quién se le paga. Lo que falta es POR QUÉ:
-- qué hecho concreto ganó, con qué política y con qué ventana. Sin eso, una
-- comisión discutida seis semanas después solo se puede defender repitiendo el
-- cálculo con las reglas de hoy, que son justo las que pueden haber cambiado.
alter table sales_order
  add column if not exists attribution_id uuid references seller_attribution(id) on delete set null,
  -- La política tal como estaba el día de la venta.
  add column if not exists attribution_policy text
    check (attribution_policy is null or attribution_policy in ('first','last','booking'));

create index if not exists sales_order_attribution_idx
  on sales_order (attribution_id) where attribution_id is not null;

-- ── la política de la empresa ──────────────────────────────────────────────
alter table organizations
  -- 'first'   = quien lo trajo (premia la captación). Es el defecto.
  -- 'last'    = quien lo cerró.
  -- 'booking' = quien tomó la reserva.
  add column if not exists attribution_policy text not null default 'first'
    check (attribution_policy in ('first','last','booking')),
  -- Días que vive una atribución sin convertirse. 0 o menos = no caduca.
  --
  -- Que caduque es deliberado: un QR escaneado hace ocho meses no es quien
  -- trajo la venta de hoy, y pagarla sería inventar una deuda.
  add column if not exists attribution_window_days integer not null default 30;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_attribution_window_check') then
    alter table organizations add constraint organizations_attribution_window_check
      check (attribution_window_days >= 0 and attribution_window_days <= 3650);
  end if;
end $$;

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- La misma ayuda que el resto de las tablas de inquilino: una política escrita
-- a mano aquí sería la que se quedaría atrás el día que cambie la forma de
-- resolver la organización de la sesión.
--
-- El registro del embudo ocurre en una superficie pública y sin sesión, así que
-- escribe con el rol de servicio y filtro explícito de empresa —igual que el
-- motor de reservas de 0047—, no abriendo nada a `anon`.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'seller_type' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.seller_type');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'seller_link' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.seller_link');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'seller_attribution' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.seller_attribution');
  end if;
end $$;
