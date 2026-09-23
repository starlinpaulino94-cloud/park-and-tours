-- 0082 · parte 1 de 1 — Los tres modos de cobro, declarados.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo.
--
-- QUÉ HACE
--  · `collection_mode` en la relación comercial (los dos modos del socio), en
--    la ficha de vendedor (solo el de retención) y en la venta, que guarda el
--    que se le aplicó.
--  · El valor por defecto es `operator_collects` en todas: es lo que el sistema
--    hace hoy con ABSOLUTAMENTE todas las ventas. Nacer en otro modo cambiaría
--    de golpe dónde está el dinero de todo lo que ya existe.
--
-- NO borra ni cambia ninguna fila: las que existen toman el valor por defecto.
-- La venta admite nulo a propósito — rellenar un histórico con un modo que
-- nadie declaró sería afirmar algo sobre ventas viejas que nadie comprobó.

alter table organization_relationships
  add column if not exists collection_mode text not null default 'operator_collects'
    check (collection_mode in ('operator_collects','pos_collects','seller_retains'));

comment on column organization_relationships.collection_mode is
  'Quién cobra al turista en las ventas de este socio (0082). `pos_collects` '
  'significa que su mostrador se queda el dinero y debe el neto: su efectivo '
  'no pasa por la caja de la operadora, y por eso el arqueo interno lo excluye '
  '(0081).';

-- El tercero es de la PERSONA: un promotor retiene y el cajero del mostrador
-- no, trabajando los dos para la misma operadora.
--
-- `pos_collects` no tiene sentido en una ficha de vendedor —el punto de venta
-- es el socio, no la persona— y por eso el `check` de aquí solo admite dos
-- valores. Admitir los tres invitaría a declarar en la ficha algo que luego
-- decide el contrato, y las dos declaraciones acabarían discrepando.
alter table seller
  add column if not exists collection_mode text not null default 'operator_collects'
    check (collection_mode in ('operator_collects','seller_retains'));

comment on column seller.collection_mode is
  'Si esta persona retiene su comisión en el acto (0082). Solo decide cuando '
  'la venta no lleva contrato de socio: el del socio manda, o un vendedor de '
  'un tour center retendría de un dinero que la operadora nunca ve pasar.';

-- Y LA VENTA guarda el que se le aplicó. Es la lección de la cancelación del
-- monedero (6.6): un contrato que cambia entre la venta y el cobro dejaría el
-- dinero movido bajo un modo y la liquidación calculada con otro, y nadie
-- sabría cuál de los dos fue el que pasó.
alter table sales_order
  add column if not exists collection_mode text
    check (collection_mode is null or collection_mode in
      ('operator_collects','pos_collects','seller_retains'));

comment on column sales_order.collection_mode is
  'El modo con el que se cerró ESTA venta (0082). Se sella al crearla y no se '
  'toca: lo que manda es lo que pasó, no lo que se pacta ahora. Nulo en las '
  'ventas anteriores a esta migración, que son todas `operator_collects` — el '
  'único modo que el sistema sabía hacer.';

create index if not exists sales_order_collection_mode_idx
  on sales_order (organization_id, collection_mode)
  where collection_mode is not null and collection_mode <> 'operator_collects';

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Todas las relaciones y todos los vendedores tienen que salir en
-- `operator_collects`, y ninguna venta con modo declarado todavía.
select 'relaciones' as que, collection_mode, count(*)
  from organization_relationships group by collection_mode
union all
select 'vendedores', collection_mode, count(*)
  from seller group by collection_mode
union all
select 'ventas', coalesce(collection_mode, '(sin declarar)'), count(*)
  from sales_order group by collection_mode
 order by que, collection_mode;
