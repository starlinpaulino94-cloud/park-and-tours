-- ═══════════════════════════════════════════════════════════════════════════
-- 0103 — EL SALDO REGALO SE PUEDE GASTAR
--
-- ───────────────────────────────────────────────────────────────────────────
-- EL HUECO
--
-- El sistema sabía emitir gift cards, consumirlas, devolverlas y anularlas
-- desde su pantalla, y llevaba su libro de movimientos. Lo que NO podía hacer
-- era **pagar una orden con una**: `payment_method` (0003) tiene ocho valores
-- y ninguno es la tarjeta.
--
-- En la práctica eso significaba que el saldo emitido no servía para comprar.
-- El cajero consumía saldo en el cajón de la tarjeta, escribía el número de
-- orden en la nota a mano, y después cobraba la orden por otro método. Dos
-- gestos sin relación: si se olvidaba el segundo, la orden quedaba impagada con
-- el saldo ya gastado; si se olvidaba el primero, al revés.
--
-- ───────────────────────────────────────────────────────────────────────────
-- Y LA CONTABILIDAD, QUE ES LA MITAD QUE NO SE VE
--
-- Emitir una gift card NO es un ingreso: es una deuda con el portador. El
-- ingreso se reconoce al consumirla, cuando el servicio se da.
--
--   Emitir:   Dr caja o banco        / Cr 2202 Pasivo por gift cards
--   Consumir: Dr 2202                / Cr 4101 Ingresos
--
-- La cuenta 2202 existe en el plan base desde el primer día y **ningún asiento
-- la tocaba**: la emisión no contabilizaba nada, y `source_type = 'gift_card'`
-- estaba permitido por el `check` de 0038 y sin usar. Al hacer la tarjeta un
-- método de cobro, el consumo empieza a debitar 2202, así que sin el apunte de
-- la emisión el pasivo se iría a NEGATIVO — un balance que dice que los
-- clientes le deben saldo a la empresa.
--
-- Por eso esta migración trae también la columna con la que el asiento apunta a
-- la tarjeta que lo causó: sin ella la referencia se perdería y el apunte no
-- podría ser idempotente, que en un asiento de dinero no es un detalle.
--
-- ───────────────────────────────────────────────────────────────────────────
-- SOBRE `ALTER TYPE ... ADD VALUE` EN UNA TRANSACCIÓN
--
-- Postgres 12+ lo admite dentro de una transacción con una condición: el valor
-- nuevo **no se puede usar** en esa misma transacción. Aquí no se usa —solo se
-- declara y se añade una columna que no lo menciona—, así que este fichero se
-- pega de una vez sin problema.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. El método de cobro.
alter type payment_method add value if not exists 'gift_card';

-- 2. El cobro sabe de QUÉ tarjeta salió el saldo.
--
--    Sin esta columna un cobro con método `gift_card` no diría de cuál vino, y
--    entonces: el pasivo 2202 no se puede conciliar tarjeta por tarjeta, y un
--    reembolso de ese cobro no sabe a qué tarjeta devolverle el saldo. Es la
--    misma razón por la que `stock_movement` guarda la línea de la orden de
--    compra y no solo la orden.
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

-- 3. El asiento sabe de qué tarjeta viene.
alter table ledger_entry
  add column if not exists gift_card_id uuid references gift_card(id) on delete set null;

create index if not exists ledger_entry_gift_card_idx
  on ledger_entry (organization_id, gift_card_id)
  where gift_card_id is not null;

comment on column ledger_entry.gift_card_id is
  'La gift card que causó el asiento. Con ella el apunte de emisión es idempotente: '
  'sin referencia no hay forma de saber si ya se contabilizó.';

-- 4. Y la referencia del asiento, igual (DB-001, criterio de 0102: una gift
--    card lleva el nombre y el correo de su destinatario, así que es un
--    documento sobre una persona).
-- EL DISPARADOR SE REESCRIBE COMPLETO, NO SOLO CON LA COLUMNA NUEVA.
--
-- `create trigger` no añade: sustituye. Un disparador con solo `gift_card_id`
-- habría dejado de validar las OCHO referencias que 0095 vigilaba —el pago, la
-- orden, la cuenta, el arqueo, el gasto, la cuenta por pagar, la cuenta por
-- cobrar y la liquidación—, y el agujero se habría vuelto a abrir sin que nada
-- lo dijera: exactamente lo que DB-001 vino a cerrar.
--
-- Por eso van las nueve. La lista se copia de 0095 con `gift_card_id` al final.
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
