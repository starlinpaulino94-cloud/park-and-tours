-- 0082 — Quién se queda el dinero entre la venta y el servicio.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- TRES MODOS, Y EL SISTEMA SOLO CONOCÍA UNO
--
--   operator_collects — paga todo el cliente al operador. Es lo que hace hoy el
--                       sistema con ABSOLUTAMENTE todas las ventas.
--   pos_collects      — cobra el punto de venta y DEBE el neto. El tour center
--                       se queda el dinero del turista en su mostrador; su
--                       efectivo no es de la operadora ni un día.
--   seller_retains    — el vendedor retiene su comisión como depósito y el
--                       cliente paga el resto al subir. Es como trabaja el
--                       promotor de playa.
--
-- Sin declararlo, los tres se parecen bastante en la pantalla de cobro y se
-- distinguen un mes después, cuando alguien intenta cuadrar qué se cobró, quién
-- lo tiene y a quién se le debe.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EN TRES SITIOS, Y CADA UNO TIENE SU MOTIVO
--
-- Los dos primeros son del CONTRATO con el tour center: la misma agencia puede
-- cobrar ella con una operadora y no con otra. Van en la relación, al lado de
-- `pricing_model` (0078) y `payment_mode` (0080).
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

-- ─────────────────────────────────────────────────────────────────────────────
-- EL VALOR POR DEFECTO ES `operator_collects`, Y NO ES UN DETALLE
--
-- Es lo que el sistema hace hoy con todas las ventas. Nacer en cualquier otro
-- modo cambiaría de golpe, el día del despliegue, dónde está el dinero de todas
-- las ventas existentes: el efectivo de la operadora pasaría a contarse como
-- deuda del punto de venta, o la comisión de cada vendedor aparecería como ya
-- cobrada sin que nadie le haya dado un peso.
--
-- Las filas que ya existen toman el valor por defecto sin tocarlas, así que no
-- hace falta relleno. Se deja dicho para que no se busque.
--
-- La venta es la excepción y admite nulo a propósito: rellenar un histórico
-- entero con un modo que nadie declaró sería afirmar algo sobre ventas viejas
-- que nadie comprobó. `null` ahí significa «anterior a esto», y la aplicación
-- lo lee como `operator_collects`, que es lo que de verdad pasó.
