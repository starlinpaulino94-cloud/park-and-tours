-- ═══════════════════════════════════════════════════════════════════════════
-- 0047 — EL MOTOR DE RESERVAS PÚBLICO
--
-- POR QUÉ
--
-- Hasta aquí el sistema solo sabe vender por dentro: alguien del equipo teclea
-- la venta. Eso deja fuera al cliente que encuentra la excursión a las once de
-- la noche y quiere reservarla, y obliga a la operadora a contestar WhatsApps
-- para tomar datos que el propio cliente podría escribir mejor.
--
-- DOS INTERRUPTORES, Y LOS DOS APAGADOS
--
-- Esta es la primera superficie donde alguien SIN CUENTA puede escribir en la
-- base, así que nada se publica por accidente:
--
--  1. La empresa activa su página (`public_booking_enabled`). Sin eso, su slug
--     no existe para el mundo.
--  2. Cada producto se publica uno a uno (`published`). Hay excursiones que solo
--     se venden a agencias, otras a medio armar y otras con precio de mostrador:
--     publicar el catálogo entero por defecto sería enseñar lo que no se quiere
--     enseñar, y eso no se puede deshacer una vez indexado.
--
-- LO QUE NO CAMBIA
--
-- No se abre ninguna política de RLS a `anon`. La API pública lee y escribe con
-- el rol de servicio y filtro explícito de empresa, que es la forma de que «lo
-- público» sea EXACTAMENTE lo que estas dos banderas dicen y ni una fila más.
-- ═══════════════════════════════════════════════════════════════════════════

alter table organizations
  add column if not exists public_booking_enabled boolean not null default false,
  -- Texto de bienvenida de la página. Vacío = se usa el nombre y ya.
  add column if not exists public_intro text,
  -- Aviso que el cliente ve antes de confirmar: política de pago, dónde pagar.
  add column if not exists public_terms text;

alter table product
  add column if not exists published boolean not null default false,
  -- Precio «desde» para la tarjeta del catálogo, cuando el real depende de
  -- modalidad o temporada. Sin esto, la tarjeta o miente o no dice precio.
  add column if not exists public_price_from numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_public_price_from_check') then
    alter table product add constraint product_public_price_from_check
      check (public_price_from is null or public_price_from >= 0);
  end if;
end $$;

-- El catálogo público se consulta por empresa y solo trae lo publicado.
create index if not exists product_published_idx
  on product (organization_id, sort_order)
  where published;

-- ── de dónde vino la reserva ───────────────────────────────────────────────
--
-- `channel` ya distingue el origen, pero no dice QUÉ pidió el cliente ni con
-- qué datos: eso llega en texto libre y se pierde. Se guarda la petición tal
-- cual para poder reconstruir después una reserva que no cuadra.
alter table booking
  add column if not exists public_request jsonb;
