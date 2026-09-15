-- ============================================================================
-- 0041 — Park & Tours como sistema satélite de MembeGo
--
-- MembeGo es la plataforma de membresías del mismo dueño: los clientes activan
-- su membresía y la validan por QR en los negocios. Su arquitectura de
-- integración ya está definida y en producción (docs/INTEGRACIONES.md de ese
-- repo): MembeGo es el hub de identidad y fidelización, y cada sistema
-- operativo de un vertical —aquí, el de EXCURSIONES— se conecta como satélite:
--
--   · SSO entrante: el equipo de la empresa entra a Park & Tours desde el
--     lanzador de MembeGo con un token firmado (HMAC, 90 segundos, un solo uso).
--   · Webhooks firmados: MembeGo empuja los clientes, visitas, compras y
--     membresías de CADA empresa vinculada. El satélite jamás consulta datos
--     de empresas ajenas.
--
-- Este esquema guarda las cuatro cosas que el contrato exige al satélite:
-- el vínculo empresa MembeGo ↔ organización, el mapa usuario MembeGo ↔ cuenta
-- local, el espejo de clientes con su membresía, y la idempotencia de eventos.
-- ============================================================================

-- ── el vínculo: UNA empresa de MembeGo ↔ UNA organización ──────────────────
create table if not exists membego_link (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- El companyId de MembeGo (cuid). Es la llave con la que llegan el SSO y
  -- todos los webhooks: sin esta fila, nada de esa empresa entra aquí.
  membego_company_id text not null,
  status          text not null default 'active' check (status in ('active','suspended')),
  linked_by       uuid references auth.users(id) on delete set null,
  linked_at       timestamptz not null default now(),
  last_event_at   timestamptz,
  events_received integer not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Una organización tiene un solo vínculo, y una empresa de MembeGo también:
  -- dos organizaciones leyendo los clientes de la misma empresa sería un cruce
  -- de datos, no una integración.
  unique (organization_id),
  unique (membego_company_id)
);

drop trigger if exists membego_link_touch on membego_link;
create trigger membego_link_touch before update on membego_link
  for each row execute function app.touch_updated_at();

-- ── el mapa de identidad: sub de MembeGo → cuenta local ────────────────────
-- El contrato manda mapear `sub` (estable) y no el correo (cambia). Sin este
-- mapa, un cambio de correo en MembeGo crearía una segunda cuenta local.
create table if not exists membego_user (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membego_sub     text not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  membego_role    text,
  -- TRUE cuando la membresía local la creó el SSO: solo entonces el siguiente
  -- SSO puede actualizar el rol. Una cuenta que ya existía con un rol puesto a
  -- mano no se degrada porque MembeGo diga otra cosa.
  role_managed    boolean not null default false,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (membego_sub)
);

drop trigger if exists membego_user_touch on membego_user;
create trigger membego_user_touch before update on membego_user
  for each row execute function app.touch_updated_at();

-- ── el espejo de clientes y su membresía ───────────────────────────────────
-- Lo que MembeGo empuja por webhook. La ELEGIBILIDAD no se copia a propósito:
-- el contrato lo prohíbe porque decide dinero y una copia desfasada regala un
-- beneficio ya consumido. Aquí vive lo presentable —quién es, qué plan tiene,
-- hasta cuándo— y el canje, cuando llegue, se hará contra la API de MembeGo.
create table if not exists membego_customer (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membego_cliente_id text not null,
  customer_id     uuid references customer(id) on delete set null,
  plan_id         text,
  plan_name       text,
  membership_id   text,
  membership_paid boolean,
  membership_valid_until timestamptz,
  visits          integer not null default 0,
  purchases       integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, membego_cliente_id)
);

create index if not exists membego_customer_customer_idx on membego_customer (customer_id);

drop trigger if exists membego_customer_touch on membego_customer;
create trigger membego_customer_touch before update on membego_customer
  for each row execute function app.touch_updated_at();

drop trigger if exists membego_customer_same_tenant_refs on membego_customer;
create trigger membego_customer_same_tenant_refs
before insert or update of organization_id, customer_id on membego_customer
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer'
);

-- ── idempotencia de eventos: la fila ES el procesado ───────────────────────
-- El mismo evento puede llegar más de una vez (reintentos del outbox de
-- MembeGo). El `event_id` es la clave primaria: el primer insert entra y el
-- segundo choca — sin lectura previa, y por tanto sin la ventana entre
-- comprobar y marcar por la que dos entregas simultáneas pasarían las dos.
create table if not exists membego_event (
  event_id        text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  tipo            text not null,
  payload         jsonb not null default '{}',
  status          text not null default 'processed'
                    check (status in ('processed','ignored','failed')),
  error           text,
  received_at     timestamptz not null default now()
);

create index if not exists membego_event_org_idx on membego_event (organization_id, received_at desc);

-- ── un token SSO se canjea UNA vez ─────────────────────────────────────────
-- Mismo truco: el jti es la clave primaria y el segundo canje choca en el
-- insert. Las filas caducan con el token y un cron podrá purgarlas; mientras
-- existan, un token capturado del historial del navegador no abre nada.
create table if not exists membego_sso_jti (
  jti        text primary key,
  used_at    timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists membego_sso_jti_expires_idx on membego_sso_jti (expires_at);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- `membego_sso_jti` no lleva RLS de inquilino: no tiene organización —un token
-- se canjea antes de saber a qué organización abre— y no contiene ningún dato,
-- solo un identificador opaco ya consumido. Solo lo toca el servicio.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'membego_link' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.membego_link');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'membego_user' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.membego_user');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'membego_customer' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.membego_customer');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'membego_event' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.membego_event');
  end if;
end $$;

alter table membego_sso_jti enable row level security;
