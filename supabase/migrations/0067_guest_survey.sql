-- ═══════════════════════════════════════════════════════════════════════════
-- 0067 — LA VOZ DEL CLIENTE
--
-- LO QUE PASA HOY
--
-- El tour termina, el pasajero se baja de la guagua y deja de existir para el
-- sistema. De 114 tablas no hay ninguna de opinión: no se sabe cómo le fue, no
-- se sabe qué guía deja clientes contentos y qué guía deja quejas, y no se le
-- pide la reseña en el único momento en que la escribe, que es el mismo día.
--
-- Y hay una plantilla, `post_tour_thanks`, escrita hace olas, con su desfase de
-- cuatro horas y su disparador documentado —«4 horas después de terminar»—.
-- NO LA ENCOLA NADIE. Es el mismo caso que `departure.waitlist_pax` antes de la
-- ola 11: una promesa escrita que ninguna línea de código cumple.
--
-- Peor todavía: el texto de esa plantilla dice «contéstanos a este mismo
-- correo». Aunque se mandara, la respuesta caería en una bandeja de entrada.
-- Nadie la tabula, nadie la atribuye a un guía y nadie la convierte en una
-- reseña pública. Preguntar sin medir es no preguntar.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LAS DECISIONES QUE GOBIERNAN EL DISEÑO
--
-- 1. UNA FILA POR RESERVA, SIEMPRE, INCLUSO CUANDO NO SE PREGUNTA
--
-- La fila se crea aunque la encuesta no se llegue a mandar, con el motivo
-- escrito (`skip_reason`). Sin eso, el panel diría «12 % de respuesta» sin
-- distinguir entre «no contestaron» y «no se les preguntó», que son dos
-- problemas distintos con dos arreglos distintos. Una tasa de respuesta que
-- miente es peor que no tenerla.
--
-- 2. AL CLIENTE DE UNA OTA NO SE LE ESCRIBE
--
-- No es una limitación técnica: es el contrato. El revendedor es el dueño de
-- esa relación, el correo que cede suele ser un alias suyo, y escribirle
-- directamente al pasajero para pedirle una reseña es la forma más rápida de
-- que una OTA corte el canal. Queda la fila con `skip_reason = 'ota'` para que
-- la operadora vea cuánta de su opinión vive fuera de su alcance.
--
-- 3. EL ENLACE CADUCA
--
-- Un enlace sin sesión que vale para siempre es una superficie abierta en un
-- correo que cualquiera reenvía. Treinta días es más que de sobra para una
-- opinión sobre un día concreto.
--
-- 4. EL GUÍA SE GUARDA AL PREGUNTAR, NO AL LEER
--
-- La asignación de una salida cambia —alguien se enferma, se reasigna—, así que
-- resolver el guía en el momento de mirar el panel contaría la nota de hoy al
-- guía de mañana. Se congela cuando se pregunta.
--
-- 5. UN DETRACTOR NO ES UN DATO, ES UNA LLAMADA
--
-- Una nota baja abre un caso de huésped (`guest_case`, que existe desde 0010
-- con su tipo 'complaint' y su compensación). Un panel donde el detractor solo
-- baja una media es un panel que no sirve: lo que recupera al cliente es que
-- alguien lo llame ese mismo día.
--
-- LO QUE NO LLEVA, A PROPÓSITO
--
-- No hay cuestionario configurable ni preguntas por producto. Una encuesta que
-- se puede alargar se alarga, y una encuesta larga no se contesta: la tasa de
-- respuesta se hunde y con ella el dato. Son una nota de 0 a 10, tres
-- valoraciones opcionales y un comentario. Si algún día hace falta más, se
-- añade con su migración y su motivo.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists guest_survey (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,

  -- Sobre qué se pregunta. La reserva manda: una encuesta es de UN pasajero
  -- sobre UN día, no de una orden que puede llevar tres excursiones distintas.
  booking_id   uuid not null references booking(id) on delete cascade,
  departure_id uuid references departure(id) on delete set null,
  product_id   uuid references product(id) on delete set null,
  customer_id  uuid references customer(id) on delete cascade,

  -- Quién lo llevó, congelado al preguntar (decisión 4).
  guide_staff_id uuid references staff(id) on delete set null,

  -- El enlace. Único en TODA la tabla y no por empresa: la página pública no
  -- tiene sesión ni sabe de qué operadora es el cliente, así que resuelve por
  -- el token a secas. Si dos empresas pudieran tener el mismo, el pasajero de
  -- una vería la encuesta de la otra.
  token text not null unique,

  status text not null default 'pending'
    check (status in ('pending','answered','expired','skipped')),

  -- Por qué no se preguntó (decisión 1). Obligatorio cuando se omite, y
  -- prohibido cuando sí se preguntó: un motivo suelto en una encuesta
  -- contestada haría dudar del recuento entero.
  skip_reason text
    check (skip_reason is null or skip_reason in
           ('ota','cancelled','no_show','no_contact','fatigue','no_consent')),

  asked_at    timestamptz,
  expires_at  timestamptz,
  answered_at timestamptz,

  -- LA pregunta. 0–10, la escala del NPS, porque es la única que un pasajero
  -- entiende sin explicación y la única comparable con el resto del sector.
  nps smallint check (nps is null or (nps between 0 and 10)),

  -- Las tres que dicen QUÉ arreglar cuando la nota baja. Opcionales: quien solo
  -- quiere dar la nota y cerrar, la da y cierra.
  rating_guide     smallint check (rating_guide     is null or (rating_guide     between 1 and 5)),
  rating_transport smallint check (rating_transport is null or (rating_transport between 1 and 5)),
  rating_value     smallint check (rating_value     is null or (rating_value     between 1 and 5)),

  comment text,
  language text,

  -- El embudo de reseña: a quién se le pidió la pública y quién fue.
  review_requested  boolean not null default false,
  review_clicked_at timestamptz,

  -- La recuperación: el caso que abrió una nota baja.
  guest_case_id uuid references guest_case(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Una por reserva. Es lo que impide que un barrido que corre dos veces le
  -- escriba dos veces al mismo pasajero.
  unique (organization_id, booking_id)
);

-- Contestada quiere decir contestada: con su fecha y con su nota.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'guest_survey_answered_check') then
    alter table guest_survey add constraint guest_survey_answered_check
      check (status <> 'answered' or (answered_at is not null and nps is not null));
  end if;
end $$;

-- Y omitida quiere decir omitida: con su motivo y sin nota.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'guest_survey_skip_check') then
    alter table guest_survey add constraint guest_survey_skip_check
      check ((status = 'skipped') = (skip_reason is not null));
  end if;
end $$;

-- El panel: lo último de cada empresa, por estado.
create index if not exists guest_survey_org_idx
  on guest_survey (organization_id, status, asked_at desc);

-- La reputación por producto y por guía, que es la pregunta que de verdad se
-- hace la operadora: «¿con quién salen contentos?».
create index if not exists guest_survey_product_idx
  on guest_survey (organization_id, product_id, answered_at desc)
  where status = 'answered';
create index if not exists guest_survey_guide_idx
  on guest_survey (organization_id, guide_staff_id, answered_at desc)
  where status = 'answered' and guide_staff_id is not null;

-- El barrido de caducidad solo mira las vivas.
create index if not exists guest_survey_expiry_idx
  on guest_survey (expires_at)
  where status = 'pending';

-- La fatiga: «¿a este cliente ya le preguntamos hace poco?».
create index if not exists guest_survey_customer_idx
  on guest_survey (organization_id, customer_id, asked_at desc)
  where customer_id is not null;

drop trigger if exists guest_survey_touch on guest_survey;
create trigger guest_survey_touch before update on guest_survey
  for each row execute function app.touch_updated_at();

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'guest_survey' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.guest_survey');
  end if;
end $$;

-- ── el que no quiere que le escriban ──────────────────────────────────────
--
-- Una encuesta y una petición de reseña NO son un mensaje de servicio: el
-- recordatorio de la víspera lleva la hora de recogida y el cliente lo necesita,
-- pero «¿cómo te fue?» se le puede pedir a alguien que no quiere que le
-- escriban, y ese alguien tiene derecho a decir que no en un clic.
--
-- Por eso la baja es SUYA y no de la operadora: se da de baja desde el pie de
-- la propia encuesta, sin cuenta y sin llamar a nadie. Y no calla los mensajes
-- de servicio, que siguen saliendo porque son parte de lo que compró.
alter table customer
  add column if not exists survey_opt_out boolean not null default false;

-- ── dónde mandar al promotor ──────────────────────────────────────────────
-- A un cliente que pone 9 o 10 se le pide la reseña pública, y la reseña
-- pública no vive aquí: vive en Google, en TripAdvisor o en la ficha de la OTA.
-- Sin esta dirección el embudo se corta justo donde empieza a valer dinero, así
-- que es un ajuste de la empresa y no una constante del código.
alter table organizations
  add column if not exists review_url text;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — que la migración falle aquí y no en producción
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  faltan text := '';
begin
  if not exists (select 1 from information_schema.tables where table_name = 'guest_survey')
    then faltan := faltan || 'tabla guest_survey '; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'organizations' and column_name = 'review_url')
    then faltan := faltan || 'organizations.review_url '; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'customer' and column_name = 'survey_opt_out')
    then faltan := faltan || 'customer.survey_opt_out '; end if;

  if not exists (select 1 from pg_constraint where conname = 'guest_survey_answered_check')
    then faltan := faltan || 'check de contestada '; end if;

  if not exists (select 1 from pg_constraint where conname = 'guest_survey_skip_check')
    then faltan := faltan || 'check de omitida '; end if;

  if not exists (select 1 from pg_indexes where indexname = 'guest_survey_expiry_idx')
    then faltan := faltan || 'índice de caducidad '; end if;

  if not exists (select 1 from pg_indexes where indexname = 'guest_survey_guide_idx')
    then faltan := faltan || 'índice por guía '; end if;

  -- El token tiene que ser único en toda la tabla, no por empresa.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.guest_survey'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
           from unnest(c.conkey) k join pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k) = array['token']
  ) then faltan := faltan || 'unicidad global del token '; end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'guest_survey' and policyname = 'tenant_select')
    then faltan := faltan || 'RLS '; end if;

  if faltan <> '' then
    raise exception '0067 incompleta, falta: %', faltan;
  end if;
end $$;
