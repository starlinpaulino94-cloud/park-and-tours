-- ═══════════════════════════════════════════════════════════════════════════
-- 0056 — CONECTOR OTA: HABLAR EL IDIOMA QUE LAS OTA YA HABLAN
--
-- POR QUÉ ESTE Y NO «UN CONECTOR DE VIATOR»
--
-- La hoja de ruta pedía «empezar por un conector, Viator o GetYourGuide». Al
-- investigarlo aparece que ese no es el trabajo. Las OTA de excursiones no se
-- integran una a una desde hace años: existe OCTO (Open Connectivity for
-- Tours, Activities and Attractions), una especificación ABIERTA que define los
-- mismos endpoints, los mismos campos y los mismos estados para todos, y que
-- GetYourGuide, Viator, Klook y las plataformas de conectividad consumen.
--
-- La diferencia práctica es enorme:
--
--   · Un cliente de Viator exigiría credenciales de Viator, revisión de Viator
--     y código que solo sirve para Viator. Y al día siguiente, otro para
--     GetYourGuide. Son integraciones que caducan.
--   · Hablar OCTO significa que la operadora publica UNA dirección y CUALQUIER
--     revendedor que hable el estándar se conecta sin que nosotros toquemos
--     nada. El trabajo se hace una vez.
--
-- Y hay una razón de dirección: en este negocio la operadora es el PROVEEDOR,
-- no el que compra. Quien tiene el inventario es ella. Por eso lo que se
-- construye es el LADO PROVEEDOR del estándar: los revendedores consultan
-- nuestro catálogo, nuestra disponibilidad y crean reservas contra nosotros.
--
-- QUÉ AÑADE, Y POR QUÉ TAN POCO
--
-- Casi nada nuevo, y eso es la señal de que el mapeo es el correcto:
--
--   OCTO Supplier     → la organización
--   OCTO Product      → `product`
--   OCTO Option       → `product_modality` (más una opción por defecto)
--   OCTO Unit         → adulto / niño / infante, que es lo que la reserva ya
--                       guarda como `adults`, `children`, `infants`
--   OCTO Availability → `departure`
--   OCTO Booking      → una `booking` (con su `sales_order` de una línea)
--   reseller          → `partner`, con su llave de API (0050) y su cupo (0054)
--
-- Lo único que no tenía dónde vivir es la IDENTIDAD que el revendedor le pone a
-- la reserva —su uuid, su referencia, el desglose por unidad que nos mandó— y
-- el ESTADO del ciclo OCTO, que no es el nuestro: OCTO distingue ON_HOLD de
-- CONFIRMED y, sobre todo, EXPIRED de CANCELLED. Para una OTA no es lo mismo
-- que la retención venciera a que alguien cancelara: lo primero es suyo, lo
-- segundo es una incidencia con el cliente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table booking
  -- El identificador que manda el revendedor en la reserva. Es SUYO: si
  -- reintenta con el mismo uuid tiene que recibir la misma reserva y no otra.
  -- Por eso es único por organización y no una clave nuestra: la idempotencia
  -- del estándar se apoya exactamente en este campo.
  add column if not exists octo_uuid uuid,

  -- La opción que eligió (una modalidad del producto, o 'default' cuando el
  -- producto no tiene modalidades). Texto y no una referencia, porque el valor
  -- 'default' no existe como fila y forzarlo a existir obligaría a sembrar una
  -- modalidad falsa en cada producto de cada empresa.
  add column if not exists octo_option_id text,

  -- El estado del ciclo OCTO tal como se le contestó al revendedor.
  --
  -- No se deriva del nuestro y esto es deliberado: nuestro `status` no sabe
  -- distinguir «la retención venció» de «lo canceló el cliente», y esas dos
  -- cosas se liquidan distinto con una OTA. Lo que sí hace el dominio puro es
  -- RECONCILIAR: si aquí dice ON_HOLD y la retención ya pasó, lo que se
  -- contesta es EXPIRED. La columna guarda la intención; la función dice la
  -- verdad.
  add column if not exists octo_status text,

  -- La referencia del revendedor (su número de pedido). Es lo que la operadora
  -- busca cuando la OTA escribe «reserva GYG-88213 no aparece».
  add column if not exists octo_reseller_reference text,

  -- El desglose por unidad tal como llegó: un elemento por viajero, con su
  -- propio uuid. Hay que devolverlo idéntico en cada respuesta —el revendedor
  -- imprime un ticket por unidad— y nuestra reserva solo guarda los totales
  -- por tramo de edad, así que sin esto no habría forma de reconstruirlo.
  add column if not exists octo_unit_items jsonb not null default '[]'::jsonb,

  -- El contacto tal como lo mandó el revendedor. La ficha de cliente se
  -- normaliza y se fusiona con la que ya existiera; esto es el original, que es
  -- lo que hay que enseñar cuando los dos lados discuten un dato.
  add column if not exists octo_contact jsonb,

  -- Reserva de prueba. Toda OTA certifica la conexión contra el entorno real
  -- antes de abrir la venta, y esas reservas no son negocio: no deben contar en
  -- los informes ni salir en la caja del día.
  add column if not exists octo_test_mode boolean not null default false,

  -- Cuándo se confirmó, en el sentido del estándar (no cuándo se cobró).
  add column if not exists octo_confirmed_at timestamptz;

-- ── los estados del estándar, ni uno más ──────────────────────────────────
-- Escribir aquí un estado que OCTO no define sería inventarse una palabra que
-- el revendedor no sabe interpretar; se enteraría en producción.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booking_octo_status_check') then
    alter table booking add constraint booking_octo_status_check
      check (octo_status is null or octo_status in (
        'ON_HOLD', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'REDEEMED', 'PENDING', 'REJECTED'
      ));
  end if;
end $$;

-- ── la idempotencia del estándar ──────────────────────────────────────────
-- Un revendedor REINTENTA. Sin esta unicidad, el reintento de una reserva a
-- medio camino crea una segunda reserva con las mismas plazas y el mismo
-- pasajero, y la operadora lo descubre cuando sobra un asiento en la guagua.
--
-- Se crea de forma tolerante: si una base ya trae duplicados (importaciones
-- previas), la migración no puede quedar bloqueada — avisa y deja el índice no
-- único, que sigue sirviendo para buscar.
do $$
begin
  begin
    create unique index if not exists booking_octo_uuid_idx
      on booking (organization_id, octo_uuid)
      where octo_uuid is not null;
  exception when unique_violation then
    raise warning 'booking: hay octo_uuid repetidos en una misma organización; se crea el índice sin unicidad. Depúralos y vuelve a crear booking_octo_uuid_idx como único.';
    create index if not exists booking_octo_uuid_idx
      on booking (organization_id, octo_uuid)
      where octo_uuid is not null;
  end;
end $$;

-- La pantalla de canales lista «lo que entró por OTA» por estado y por fecha.
create index if not exists booking_octo_status_idx
  on booking (organization_id, octo_status, booking_date desc)
  where octo_uuid is not null;

-- ── de qué llave vino ─────────────────────────────────────────────────────
-- `booking.partner` ya dice QUIÉN revende. Esto dice CON QUÉ LLAVE entró, que
-- es distinto y es lo que hace falta el día que hay que revocar una: sin ello,
-- revocar una llave es a ciegas porque nadie sabe qué reservas trajo.
alter table booking
  add column if not exists octo_api_key_id uuid references api_key(id) on delete set null;

-- ── la retención que se le prometió al revendedor ─────────────────────────
-- OCTO deja que el revendedor pida cuántos minutos quiere retener la plaza, y
-- eso NO es la retención por defecto de la empresa (`organizations.hold_hours`,
-- pensada para una venta de mostrador que se paga por transferencia). El plazo
-- vive en `sales_order.hold_until`, que ya existe y que el barrido de
-- retenciones vencidas ya respeta; lo que faltaba era poder negarse a un plazo
-- absurdo.
alter table organizations
  -- Máximo que la operadora acepta retener a un revendedor sin cobro. Nulo =
  -- se usa el valor por defecto del dominio.
  add column if not exists octo_max_hold_minutes integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_octo_hold_check') then
    alter table organizations add constraint organizations_octo_hold_check
      check (octo_max_hold_minutes is null or (octo_max_hold_minutes between 1 and 10080));
  end if;
end $$;
