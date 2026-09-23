-- 0080 · parte 2 de 3 — Los disparadores y el modo de pago.
--
-- Ejecuta la parte 1 ANTES que esta. Luego la parte 3.
--
-- QUÉ HACE
--  · Los dos disparadores de la tabla: la marca de tiempo y el cerrojo de
--    empresa (una fila no puede apuntar a la orden de otra operadora).
--  · Añade `payment_mode` a la relación comercial, con valor por defecto
--    `credit` — que es lo que hacen hoy TODOS los socios. Nacer en `prepaid`
--    les cortaría la venta a todos de golpe, porque todos los monederos nacen
--    con saldo cero.
--
-- NO borra ni cambia ninguna fila: las existentes toman el valor por defecto.

create trigger partner_wallet_touch before update on partner_wallet_movement
  for each row execute function app.touch_updated_at();

-- El mismo cerrojo que el resto: la fila tiene que ser de la misma empresa que
-- la orden a la que apunta.
drop trigger if exists partner_wallet_same_tenant on partner_wallet_movement;
create trigger partner_wallet_same_tenant
before insert or update of organization_id, order_id, booking_id on partner_wallet_movement
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order', 'booking_id', 'booking');

-- ─────────────────────────────────────────────────────────────────────────────
-- CÓMO PAGA ESTE SOCIO: declarado, como el modelo de precio de 0078
--
-- Va en la RELACIÓN porque es del contrato: la misma agencia puede trabajar a
-- crédito con una operadora y prepago con otra.
--
-- Y el valor por defecto es `credit` a propósito: es lo que hace hoy el sistema
-- con todos los socios. Nacer en `prepaid` les cortaría la venta a todos de
-- golpe en el despliegue, porque todos los monederos nacen con saldo cero. Es
-- el mismo apagón silencioso que evita la siembra de 0077.

alter table organization_relationships
  add column if not exists payment_mode text not null default 'credit'
    check (payment_mode in ('credit','prepaid'));

comment on column organization_relationships.payment_mode is
  'Cómo paga el socio (0080). `credit`: vende ahora y debe después, con el '
  'techo de `credit_limit`. `prepaid`: ingresa por adelantado y cada venta '
  'descuenta de su saldo, que es la suma de `partner_wallet_movement` — sin '
  'descubierto, porque un descubierto es un crédito que nadie pactó.';

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- «credit» para todos: ninguna relación existente debe haber nacido en prepago.
select payment_mode, count(*) as relaciones
  from organization_relationships
 group by payment_mode
 order by payment_mode;
