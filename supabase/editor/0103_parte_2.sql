-- ═══════════════════════════════════════════════════════════════════════════
-- 0103 · EL SALDO REGALO SE PUEDE GASTAR — PARTE 2 DE 2
--
-- Pega esta parte entera y dale a «Run». Se puede repetir sin daño: todo va con
-- `if not exists` o con `drop ... if exists` delante.
--
-- QUÉ HACE: dos columnas con las que el cobro y el asiento dicen DE QUÉ tarjeta
-- salió el saldo, sus índices, y los disparadores que impiden que apunten a la
-- tarjeta de otra empresa.
--
-- POR QUÉ HACEN FALTA LAS COLUMNAS. Sin `payment.gift_card_id`, un cobro con
-- método `gift_card` no diría de cuál vino: el pasivo 2202 no se puede conciliar
-- tarjeta por tarjeta, y un reembolso de ese cobro no sabe a qué tarjeta
-- devolverle el saldo. Sin `ledger_entry.gift_card_id`, el apunte de la emisión
-- no puede ser idempotente — y un asiento de dinero que se puede duplicar no es
-- un detalle.
--
-- CUIDADO SI LO EDITAS: el disparador de `ledger_entry` se identifica por
-- NOMBRE, y `create trigger` no añade — SUSTITUYE. Registrarlo con menos
-- columnas de las que ya tenía QUITA las que había. Por eso van las nueve y no
-- solo la nueva: las ocho primeras son las de 0095 (el pago, la orden, la
-- cuenta, el arqueo, el gasto, la cuenta por pagar, la cuenta por cobrar y la
-- liquidación). Dejarlas fuera reabriría el agujero que DB-001 cerró, sin que
-- nada lo dijera.
--
-- Cuando termines, corre `0103_parte_3_verificacion.sql`.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. El cobro sabe de qué tarjeta salió el saldo.
alter table payment
  add column if not exists gift_card_id uuid references gift_card(id) on delete set null;

create index if not exists payment_gift_card_idx
  on payment (organization_id, gift_card_id)
  where gift_card_id is not null;

drop trigger if exists payment_same_tenant_gift_card on payment;
create trigger payment_same_tenant_gift_card
before insert or update of organization_id, gift_card_id on payment
for each row execute function app.enforce_same_tenant_refs(
  'gift_card_id', 'gift_card'
);

-- 2. El asiento, igual.
alter table ledger_entry
  add column if not exists gift_card_id uuid references gift_card(id) on delete set null;

create index if not exists ledger_entry_gift_card_idx
  on ledger_entry (organization_id, gift_card_id)
  where gift_card_id is not null;

comment on column ledger_entry.gift_card_id is
  'La gift card que causó el asiento. Con ella el apunte de emisión es idempotente: '
  'sin referencia no hay forma de saber si ya se contabilizó.';

-- 3. Y las NUEVE referencias del asiento, no solo la nueva. Ver el aviso de
--    arriba: aquí quitar una línea quita una comprobación de aislamiento.
drop trigger if exists ledger_entry_same_tenant_refs on ledger_entry;
create trigger ledger_entry_same_tenant_refs
before insert or update of organization_id, cash_session_id, expense_id,
  ledger_account_id, order_id, payable_id, payment_id, receivable_id,
  settlement_id, gift_card_id
on ledger_entry
for each row execute function app.enforce_same_tenant_refs(
  'cash_session_id', 'cash_session',
  'expense_id', 'expense',
  'ledger_account_id', 'ledger_account',
  'order_id', 'sales_order',
  'payable_id', 'payable',
  'payment_id', 'payment',
  'receivable_id', 'receivable',
  'settlement_id', 'settlement',
  'gift_card_id', 'gift_card'
);
