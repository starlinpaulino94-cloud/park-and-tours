-- ============================================================================
-- 0042 — El plan deja de ser un adorno y pasa a decidir
--
-- La plataforma se vende por planes desde 0009: `plan` tiene precio, límites
-- (`max_users`, `max_bookings_month`, `max_products`, `max_storage_mb`),
-- `trial_days` y `modules_enabled`. Stripe cobra la suscripción y el webhook
-- escribe el estado en la organización.
--
-- Y NADA DE ESO DECIDÍA NADA. Auditado sobre el código: ninguna ruta lee un
-- límite, `modules_enabled` solo oculta entradas del menú —la API acepta todo
-- igual—, y el periodo de prueba no podía vencer porque la columna donde
-- terminaba NO EXISTÍA. Se podía registrar una empresa, no pagar nunca y seguir
-- operando sin límite. Un SaaS que no puede cobrar no es un SaaS.
--
-- Esta migración prepara la base para que el plan se aplique de verdad:
--
--   1. Las columnas que el tipo de TypeScript prometía y la base no tenía.
--   2. La llave foránea que faltaba: `plan_id` era un uuid suelto.
--   3. El dominio de `subscription_status`, que era texto libre.
--   4. Los cuatro planes sembrados, para que la decisión tenga contra qué medirse.
--   5. El índice con el que se cuenta el uso del mes.
--
-- Todo aditivo e idempotente.
-- ============================================================================

-- ── 1. Las columnas que faltaban ───────────────────────────────────────────
--
-- `Company` en `src/lib/types.ts` declara `trial_ends_at`, `next_billing_at` y
-- `storage_used_mb` desde el primer día. Las tres se leían como `undefined` y
-- nadie se enteraba: el guardián de esquema (`schema-contract.test.ts`) compara
-- lo que la aplicación ESCRIBE contra las migraciones, y a estas tres nunca las
-- escribía nadie. Una promesa que no se cumple y tampoco falla es la peor
-- clase de deuda: el periodo de prueba no vencía porque no había dónde apuntar
-- cuándo termina.
alter table organizations
  add column if not exists trial_ends_at   timestamptz,
  add column if not exists next_billing_at timestamptz,
  add column if not exists storage_used_mb numeric(12,2) not null default 0;

alter table organizations drop constraint if exists organizations_storage_used_check;
alter table organizations add constraint organizations_storage_used_check
  check (storage_used_mb >= 0);

comment on column organizations.trial_ends_at is
  'Fin del periodo de prueba. NULL = sin prueba en curso (ya convertida, o plan sin trial_days).';
comment on column organizations.next_billing_at is
  'Próximo cobro. Con `subscription_status = past_due` es el origen del periodo de gracia.';

-- ── 2. La llave foránea que faltaba ────────────────────────────────────────
--
-- `plan_id` era `uuid` sin referencia: borrar un plan dejaba organizaciones
-- apuntando a un plan inexistente, y la consulta del plan devolvía nada sin
-- explicar por qué. Ahora apunta de verdad, y borrar un plan deja la
-- organización SIN plan (que el dominio trata como «sin límites declarados»)
-- en vez de con un puntero roto.
--
-- Antes de crear la restricción hay que limpiar lo que ya estuviera roto: con
-- una fila colgada, el `alter table` falla y la migración entera no entra.
update organizations o
   set plan_id = null
 where o.plan_id is not null
   and not exists (select 1 from plan p where p.id = o.plan_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'organizations_plan_id_fkey' and conrelid = 'organizations'::regclass
  ) then
    alter table organizations
      add constraint organizations_plan_id_fkey
      foreign key (plan_id) references plan(id) on delete set null;
  end if;
end $$;

-- ── 3. El estado de la suscripción, acotado ────────────────────────────────
--
-- Era `text` sin restricción. Mientras el valor no decidía nada, un 'activo'
-- escrito a mano en vez de 'active' era una curiosidad. En cuanto DECIDE si se
-- puede facturar una reserva, un valor con una letra distinta es una empresa
-- que deja de cobrar —o una que no paga y sigue operando—. El dominio se acota
-- aquí, donde no hay forma de saltárselo.
--
-- NULL sigue permitido y es deliberado: las filas `kind in ('partner','branch')`
-- no tienen suscripción propia, y las organizaciones que existían antes de esta
-- migración pueden traer cualquier cosa. Lo que no encaja se normaliza a NULL,
-- y el dominio puro trata NULL como «sin información» → NO bloquea. Fallar
-- abierto aquí es la única opción defendible: bloquear la operación de una
-- empresa que paga por una rareza de datos heredada sería un fallo peor que el
-- que esta migración viene a cerrar.
update organizations
   set subscription_status = null
 where subscription_status is not null
   and subscription_status not in ('trial','active','past_due','cancelled','suspended');

alter table organizations drop constraint if exists organizations_subscription_status_check;
alter table organizations add constraint organizations_subscription_status_check
  check (subscription_status is null or subscription_status in
    ('trial','active','past_due','cancelled','suspended'));

-- ── 4. Los cuatro planes ───────────────────────────────────────────────────
--
-- El catálogo comercial vive en la base y no en el código —cambiar un precio no
-- puede pedir un despliegue—, pero tiene que EXISTIR para que la decisión de
-- límite tenga contra qué medirse: hasta hoy `plan` podía estar vacía y el alta
-- de una empresa dejaba `plan_id = null`.
--
-- Se siembran por `code`, que es único, con `on conflict do nothing`: quien ya
-- haya ajustado sus precios o sus límites desde el panel de plataforma no los
-- pierde al reaplicar la migración. Los precios son un punto de partida
-- editable, no una decisión de producto grabada en piedra.
--
-- NULL en un límite significa ILIMITADO, no cero. Es la convención que el
-- dominio puro implementa y la que permite que 'enterprise' no tenga techo sin
-- inventar un número grande que algún día alguien alcanzaría.
insert into plan (code, name, description, monthly_price, yearly_price, currency,
                  max_users, max_bookings_month, max_products, max_storage_mb,
                  trial_days, modules_enabled, is_premium, status, sort_order)
values
  ('operador', 'Operador',
   'Para la operadora que vende, reserva y cuadra su caja.',
   49, 490, 'usd',
   3, 300, 50, 2048, 14,
   array['bookings','crm','payments','cash_pos','reports','audit'],
   false, 'active', 10),

  ('profesional', 'Profesional',
   'Añade agencias, proveedores, comisiones y facturación con NCF.',
   99, 990, 'usd',
   10, 2000, 300, 10240, 14,
   array['bookings','crm','payments','cash_pos','reports','audit',
         'commissions','settlements','b2b_portal','accounting',
         'transport','pickups','operations'],
   false, 'active', 20),

  ('parque', 'Parque',
   'Para parques y atracciones: accesos, mantenimiento e inventario.',
   199, 1990, 'usd',
   30, 10000, 1000, 51200, 14,
   array['bookings','crm','payments','cash_pos','reports','audit',
         'commissions','settlements','b2b_portal','accounting',
         'transport','pickups','operations'],
   false, 'active', 30),

  ('enterprise', 'Enterprise',
   'Multi-sucursal, API y acuerdo de servicio. Precio a medida.',
   0, 0, 'usd',
   null, null, null, null, 30,
   array['bookings','crm','payments','cash_pos','reports','audit',
         'commissions','settlements','b2b_portal','accounting',
         'transport','pickups','operations'],
   true, 'active', 40)
on conflict (code) do nothing;

-- ── 5. El índice con el que se cuenta el mes ───────────────────────────────
--
-- El límite de reservas es «cuántas creó ESTA empresa en el mes en curso», y se
-- cuenta desde las reservas mismas en vez de con un contador aparte: un
-- contador se desincroniza de la realidad y entonces cobra de más o deja pasar
-- de más, que es exactamente el fallo que `availability.ts` evita recalculando.
--
-- El índice que ya había —`booking (organization_id, status, created_at desc)`—
-- lleva `status` en medio, y la cuenta del mes no filtra por estado: una
-- reserva cancelada se creó igual. Este índice sirve a esa pregunta.
create index if not exists booking_created_idx on booking (organization_id, created_at);
