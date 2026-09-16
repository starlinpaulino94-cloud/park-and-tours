-- ═══════════════════════════════════════════════════════════════════════════
-- 0050 — LLAVES DE API: QUE OTRO SISTEMA PUEDA VENDER
--
-- POR QUÉ
--
-- Una agencia con su propia web, un tour center con su sistema, una OTA: hoy
-- ninguno puede integrarse. Todo lo que existe exige una sesión de navegador
-- con cookies, así que la única forma de trabajar con un socio es que teclee en
-- el portal B2B. Eso funciona con tres agencias y se rompe con treinta.
--
-- LO QUE SE GUARDA, Y LO QUE NO
--
-- El secreto NO se guarda. Se guarda su hash, igual que una contraseña: quien
-- consiga leer esta tabla —una copia de seguridad, un volcado mal guardado— no
-- obtiene llaves con las que vender en nombre de nadie. El secreto se enseña
-- UNA vez, al crearlo, y si se pierde se emite otro.
--
-- El prefijo sí se guarda en claro, y es lo que permite dos cosas que hacen
-- falta de verdad: encontrar la llave sin comparar contra todas —una consulta
-- por índice en vez de un recorrido— y que la pantalla muestre «pt_live_a1b2…»
-- para que un administrador sepa cuál está revocando.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists api_key (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Para qué es esta llave: «Web de Bávaro Tours», «Conector Viator».
  name        text not null,
  -- La parte pública del token. Única: es por donde se busca.
  prefix      text not null,
  -- SHA-256 del secreto. Nunca el secreto.
  secret_hash text not null,
  -- `read` consulta catálogo y disponibilidad; `write` además crea reservas.
  scope       text not null default 'read' check (scope in ('read', 'write')),
  -- Un socio concreto, cuando la llave es de una agencia: sus reservas nacen
  -- con su comisión y solo ve lo suyo.
  partner_id  uuid references organizations(id) on delete set null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists api_key_prefix_idx on api_key (prefix);
create index if not exists api_key_org_idx on api_key (organization_id, revoked_at);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'api_key_touch') then
    create trigger api_key_touch before update on api_key
      for each row execute function app.touch_updated_at();
  end if;
end $$;

-- La tabla nunca se lee desde el cliente: la autenticación de la API la
-- resuelve el servidor con el rol de servicio. RLS activa y sin políticas es
-- exactamente eso — nadie salvo el rol de servicio.
alter table api_key enable row level security;

-- ── idempotencia de las reservas por API ───────────────────────────────────
--
-- Un sistema externo reintenta: se le cae la conexión, su cola vuelve a
-- intentarlo, su servidor se reinicia a medio camino. Sin una clave, cada
-- reintento crea OTRA reserva, y el socio descubre tres reservas idénticas
-- cuando el cliente llega al bus.
alter table sales_order
  add column if not exists idempotency_key text;

create unique index if not exists sales_order_idempotency_idx
  on sales_order (organization_id, idempotency_key)
  where idempotency_key is not null;
