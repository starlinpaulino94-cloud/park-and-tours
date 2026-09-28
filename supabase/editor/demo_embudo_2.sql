-- EL EMBUDO Y LOS AJUSTES DE LA DEMOSTRACIÓN — parte 2 de 2: los dos ajustes de comisión y el neto al día
--
-- Pégalo ENTERO en el editor SQL de Supabase (Ctrl+A, Run). Aguanta
-- ejecutarse dos veces. Requiere el resto del sembrador ya aplicado (necesita
-- la empresa `havelgo-demo-presentaciones`, sus vendedores y sus ventas).
--
-- PARA QUÉ. Medido sobre la base sembrada, `seller_attribution` y
-- `commission_adjustment` tenían CERO filas: cuatro enlaces con QR y el embudo
-- a cero, y un módulo de ajustes que nadie ha visto nunca funcionar. No falta
-- código —los dos caminos están enchufados—; falta que alguien haya vendido
-- por un QR y que alguna venta se haya caído después de pagar su comisión.
--
-- Las dos partes van EN ORDEN: la 2 deja el neto de las comisiones al día.

-- ── 5. LA RECUPERACIÓN ─────────────────────────────────────────────────────
-- La venta se cayó después de haberle pagado la comisión. La comisión NO se
-- anula: se pagó. Lo que baja es el neto, y el motivo queda escrito.
insert into commission_adjustment (id, organization_id, commission_id, amount, currency, reason, reason_code, booking_id, settlement_id, created_at)
select md5('demo:' || ('cadj:1'))::uuid, c.organization_id, c.id,
    -c.amount, c.currency,
    'La reserva se canceló después de haberse pagado la comisión: se recupera en la próxima liquidación',
    'clawback', c.booking_id, md5('demo:' || ('setl:2'))::uuid,
    now() - interval '6 days'
from commission c
where c.id = md5('demo:' || ('com:4'))::uuid
  and not exists (select 1 from commission_adjustment where id = md5('demo:' || ('cadj:1'))::uuid);

-- ── 6. LA CORRECCIÓN ───────────────────────────────────────────────────────
-- Se aplicó un porcentaje que no tocaba. No se reescribe la comisión original
-- —el histórico diría que siempre fue otra cifra—: se ajusta la diferencia.
insert into commission_adjustment (id, organization_id, commission_id, amount, currency, reason, reason_code, booking_id, settlement_id, created_at)
select md5('demo:' || ('cadj:2'))::uuid, c.organization_id, c.id,
    -round(c.amount * 0.25, 2), c.currency,
    'Se liquidó al 8% una venta que iba al 6%: se ajusta la diferencia',
    'correction', c.booking_id, md5('demo:' || ('setl:2'))::uuid,
    now() - interval '3 days'
from commission c
where c.id = md5('demo:' || ('com:8'))::uuid
  and round(c.amount * 0.25, 2) <> 0
  and not exists (select 1 from commission_adjustment where id = md5('demo:' || ('cadj:2'))::uuid);

-- ── 7. EL NETO AL DÍA ──────────────────────────────────────────────────────
-- Lo que hace `syncCommissionNet` después de cada ajuste. Sin esto, la demo
-- enseñaría un ajuste escrito y un neto que no se ha enterado — que es
-- exactamente el descuadre que este bloque corrige en el código.
update commission c
   set adjustment_total = s.total,
       net_amount = greatest(0, round(c.amount + s.total, 2))
  from (
    select commission_id, sum(amount) as total
      from commission_adjustment
     where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones')
     group by commission_id
  ) s
 where c.id = s.commission_id
   and c.adjustment_total is distinct from s.total;

-- La comisión que se recuperó estaba PAGADA: es la mitad de la historia.
update commission
   set status = 'paid'
 where id = md5('demo:' || ('com:4'))::uuid
   and status <> 'paid';
