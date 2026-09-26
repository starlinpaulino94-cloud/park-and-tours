-- ════════════════════════════════════════════════════════════════════════
-- 0095 · PARTE 2 — Las 33 referencias que importan
--
-- Requiere la PARTE 1 ejecutada antes: estos disparadores llaman a la función
-- que allí se arregla. Ejecutados sin ella, la caja de un socio seguiría
-- rompiéndose igual, solo que en más tablas.
-- ════════════════════════════════════════════════════════════════════════

-- ── Las 33 referencias que importan ─────────────────────────────────────────
-- Un disparador por tabla, como estableció 0018: dos disparadores solapados
-- sobre la misma tabla harían el doble de lecturas y el día que se toque uno el
-- otro se queda atrás.

-- El asiento contable. Siete referencias, y el peor sitio posible para cruzar
-- una: una línea de la empresa A citando el pago de la B descuadra las dos.
drop trigger if exists ledger_entry_cash_session_same_tenant on ledger_entry;
drop trigger if exists ledger_entry_same_tenant_refs on ledger_entry;
create trigger ledger_entry_same_tenant_refs
before insert or update of organization_id, cash_session_id, expense_id,
  ledger_account_id, order_id, payable_id, payment_id, receivable_id, settlement_id
on ledger_entry
for each row execute function app.enforce_same_tenant_refs(
  'cash_session_id', 'cash_session',
  'expense_id', 'expense',
  'ledger_account_id', 'ledger_account',
  'order_id', 'sales_order',
  'payable_id', 'payable',
  'payment_id', 'payment',
  'receivable_id', 'receivable',
  'settlement_id', 'settlement'
);

-- La caja. `partner_id` apunta a `organizations`, y es la referencia que
-- reventaba: ahora se valida por `tenant_org_id`, que es donde vive la respuesta.
drop trigger if exists cash_session_same_tenant on cash_session;
drop trigger if exists cash_session_same_tenant_refs on cash_session;
create trigger cash_session_same_tenant_refs
before insert or update of organization_id, partner_id, branch_id, cash_register_id, seller_id
on cash_session
for each row execute function app.enforce_same_tenant_refs(
  'partner_id', 'organizations',
  'branch_id', 'branch',
  'cash_register_id', 'cash_register',
  'seller_id', 'seller'
);

drop trigger if exists cash_register_same_tenant_refs on cash_register;
create trigger cash_register_same_tenant_refs
before insert or update of organization_id, branch_id, seller_id
on cash_register
for each row execute function app.enforce_same_tenant_refs(
  'branch_id', 'branch',
  'seller_id', 'seller'
);

-- El movimiento de caja ya tenía dos referencias cubiertas desde 0018; se
-- rehace con las cuatro para no dejar dos disparadores en la misma tabla.
drop trigger if exists cash_movement_same_tenant_refs on cash_movement;
create trigger cash_movement_same_tenant_refs
before insert or update of organization_id, cash_session_id, payment_id, commission_id, seller_id
on cash_movement
for each row execute function app.enforce_same_tenant_refs(
  'cash_session_id', 'cash_session',
  'payment_id', 'payment',
  'commission_id', 'commission',
  'seller_id', 'seller'
);

-- El saldo regalo: canjearlo contra la venta de otra empresa es dinero pasando
-- de una a otra sin que nadie lo apunte.
drop trigger if exists gift_card_same_tenant_refs on gift_card;
create trigger gift_card_same_tenant_refs
before insert or update of organization_id, customer_id, order_id, product_id
on gift_card
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'order_id', 'sales_order',
  'product_id', 'product'
);

drop trigger if exists gift_card_movement_same_tenant_refs on gift_card_movement;
create trigger gift_card_movement_same_tenant_refs
before insert or update of organization_id, gift_card_id, order_id
on gift_card_movement
for each row execute function app.enforce_same_tenant_refs(
  'gift_card_id', 'gift_card',
  'order_id', 'sales_order'
);

-- La entrada. Cruzar aquí una referencia es admitir a alguien con la reserva de
-- otro — y en la puerta nadie va a mirar de qué empresa era.
drop trigger if exists access_ticket_same_tenant_refs on access_ticket;
create trigger access_ticket_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id, membership_id,
  order_id, participant_id, product_id
on access_ticket
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer',
  'membership_id', 'membership',
  'order_id', 'sales_order',
  'participant_id', 'participant',
  'product_id', 'product'
);

-- El descargo de responsabilidad. Atado a la reserva de otra empresa, la
-- operadora cree tener una firma que no tiene — y eso se descubre el día del
-- accidente.
drop trigger if exists waiver_same_tenant_refs on waiver;
create trigger waiver_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id,
  participant_id, product_id, waiver_template_id
on waiver
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer',
  'participant_id', 'participant',
  'product_id', 'product',
  'waiver_template_id', 'waiver_template'
);

-- La regla de comisión: acotada al producto o al vendedor de otra empresa, se le
-- paga al que no es.
drop trigger if exists commission_rule_same_tenant_refs on commission_rule;
create trigger commission_rule_same_tenant_refs
before insert or update of organization_id, category_id, product_id, seller_id
on commission_rule
for each row execute function app.enforce_same_tenant_refs(
  'category_id', 'product_category',
  'product_id', 'product',
  'seller_id', 'seller'
);
