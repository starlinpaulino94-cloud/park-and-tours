-- ============================================================================
-- P-001 · VOLUMEN DE UNA OPERADORA GRANDE, EN UN SOLO INQUILINO
--
-- Lo que corre encima de esto es `scripts/perf-panel.sh`. Aquí solo se siembra.
--
-- ───────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTÁ EN EL REPOSITORIO Y NO EN LA SESIÓN DE QUIEN MIDIÓ
--
-- P-001 decía «sin pruebas de carga con concurrencia» y siguió diciéndolo
-- después de medirse, porque la siembra con la que se midió vivía en un
-- terminal. Una medición que no se puede repetir es una anécdota: el número
-- envejece, nadie sabe con qué datos salió, y la siguiente vez hay que empezar
-- de cero —que es exactamente lo que pasó entre 9.17 y esta vuelta—.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LA ESCALA VA POR GUC, NO POR VARIABLE DE PSQL
--
-- `psql` NO sustituye `:variable` dentro de un bloque `$$…$$`: lo trata como
-- cadena. La mitad de esta siembra vive dentro de un `do $$`, así que una
-- variable de psql habría escalado la mitad de los recuentos y dejado la otra
-- mitad en 20.000 sin decir nada. Se pasa por ajuste de sesión, que sí entra:
--
--   psql -c "set perf.escala = 1"   -f supabase/perf/volumen.sql     (de verdad)
--   psql -c "set perf.escala = 100" -f supabase/perf/volumen.sql     (en CI)
--
-- Con escala 1: 120.000 órdenes, 120.000 reservas, 60.000 cobros, 60.000
-- comisiones, 5.600 salidas, 20.000 clientes, 40 productos, 40 vendedores.
--
-- `db-test.sh` la corre con 100 para que este fichero no se quede atrás del
-- esquema sin que nadie se entere. Una siembra de rendimiento que ya no encaja
-- con las tablas no avisa: falla el día que alguien quiere medir.
--
-- Los disparadores se apagan durante la siembra: lo que se mide con esto es la
-- LECTURA del panel, y el coste de la ESCRITURA ya está medido en 0097.
-- ============================================================================
set session_replication_role = replica;

-- Rehacer desde cero: este guion se corre varias veces mientras se mide.
delete from organizations where name in ('Operadora P-001', 'Socio P-001');

do $$
declare
  v_esc integer := greatest(1, coalesce(nullif(current_setting('perf.escala', true), ''), '1')::integer);
  v_org uuid; v_socio uuid;
begin
  insert into organizations (name, kind, currency, timezone)
    values ('Operadora P-001', 'tenant', 'usd', 'America/Santo_Domingo') returning id into v_org;
  insert into organizations (name, kind, tenant_org_id)
    values ('Socio P-001', 'partner', v_org) returning id into v_socio;
  insert into branch (organization_id, name) values (v_org, 'Sucursal 1');

  insert into product (organization_id, name, base_price, currency)
  select v_org, 'Excursion ' || g, 60 + (g % 40) * 5, 'usd'
    from generate_series(1, greatest(2, 40 / v_esc)) g;

  insert into seller (organization_id, first_name, commission_pct)
  select v_org, 'Vendedor ' || g, 10 from generate_series(1, greatest(2, 40 / v_esc)) g;

  insert into customer (organization_id, first_name, last_name)
  select v_org, 'Cliente ' || g, 'Apellido ' || g
    from generate_series(1, greatest(2, 20000 / v_esc)) g;

  /**
   * UNA SALIDA POR DÍA Y POR PRODUCTO, LOS 460 DÍAS.
   *
   * Los 460 NO se escalan: 400 días hacia atrás y 60 hacia delante es lo que
   * hace que una ventana de 365 tenga datos y que la comparativa —los 365
   * anteriores— no salga vacía. Lo que se escala es cuántos productos salen
   * cada día.
   *
   * La primera versión repartía un número fijo de salidas por los 460 días, y
   * a escala 100 dejaba DOS salidas en total: las órdenes se emparejan con la
   * salida de su día, así que de 1.200 órdenes solo seis llegaron a ser
   * reserva. La siembra no falló; devolvió una base que no servía para medir.
   */
  insert into departure (organization_id, product_id, departure_at, capacity)
  select v_org, p.id,
         (current_date - 400 + d)::timestamptz + (8 + (d % 6)) * interval '1 hour',
         30
    from generate_series(0, 459) d
    cross join (select id, row_number() over (order by name) rn
                  from product where organization_id = v_org) p
   where p.rn <= greatest(1, 12 / v_esc)
   on conflict do nothing;
end $$;

-- Los identificadores, una vez, para no hacer una subconsulta correlacionada por
-- fila: la primera versión de esta siembra tardaba SEIS MINUTOS por eso.
create temp table ids_org as select id from organizations where name = 'Operadora P-001';
create temp table ids_ven as
  select id, row_number() over () rn from seller where organization_id = (select id from ids_org);
create temp table ids_cli as
  select id, row_number() over () rn from customer where organization_id = (select id from ids_org);
create temp table ids_sal as
  select id, product_id, departure_at::date as dia from departure
   where organization_id = (select id from ids_org);
create temp table ids_suc as select id from branch where organization_id = (select id from ids_org);
create index on ids_sal (dia);

insert into sales_order (organization_id, order_number, status, channel, currency, base_currency,
                         exchange_rate, total, base_currency_total, order_date, created_at,
                         seller_id, customer_id, branch_id)
select (select id from ids_org),
       'ORD-' || g,
       (array['paid','paid','paid','completed','pending_payment','cancelled'])[1 + (g % 6)],
       (array['direct','web','ota','agency','phone'])[1 + (g % 5)]::sales_channel,
       'usd', 'usd', 1,
       100 + (g % 400), 100 + (g % 400),
       (current_date - 400 + (g % 460))::date,
       (current_date - 400 + (g % 460))::timestamptz,
       v.id, c.id, (select id from ids_suc)
  from generate_series(1, greatest(10, 120000 / greatest(1, coalesce(nullif(current_setting('perf.escala', true), ''), '1')::integer))) g
  join ids_ven v on v.rn = 1 + (g % (select count(*) from ids_ven))
  join ids_cli c on c.rn = 1 + (g % (select count(*) from ids_cli));

insert into booking (organization_id, order_id, product_id, departure_id, booking_number,
                     status, currency, base_currency, pax_total, total_amount, base_amount,
                     cost_amount, base_cost_amount, exchange_rate,
                     booking_date, seller_id, customer_id, branch_id, channel, created_at)
select o.organization_id, o.id, s.product_id, s.id,
       'BK-' || o.order_number,
       case o.status when 'cancelled' then 'cancelled' when 'pending_payment' then 'pending' else 'confirmed' end,
       'usd', 'usd',
       1 + (abs(hashtext(o.order_number)) % 4),
       o.total, o.total, round(o.total * 0.55, 2), round(o.total * 0.55, 2), 1,
       o.order_date, o.seller_id, o.customer_id, o.branch_id, o.channel, o.created_at
  from sales_order o
  join lateral (select id, product_id from ids_sal where dia = o.order_date limit 1) s on true
 where o.organization_id = (select id from ids_org);

insert into payment (organization_id, order_id, reference, amount, base_amount, currency,
                     base_currency, exchange_rate, payment_type, method, status, paid_at, created_at)
select o.organization_id, o.id, 'PAY-' || o.order_number, o.total, o.total, 'usd', 'usd', 1, 'payment',
       (array['cash','card','transfer'])[1 + (abs(hashtext(o.order_number)) % 3)]::payment_method,
       'completed', o.created_at, o.created_at
  from sales_order o
 where o.organization_id = (select id from ids_org)
   and o.status in ('paid','completed');

insert into commission (organization_id, order_id, booking_id, seller_id, beneficiary_type,
                        calc_type, base_amount, percentage, amount, currency, status,
                        service_date, created_at)
select b.organization_id, b.order_id, b.id, b.seller_id, 'seller',
       'percentage', b.total_amount, 10, round(b.total_amount * 0.10, 2), 'usd', 'approved',
       b.booking_date, b.created_at
  from booking b
 where b.organization_id = (select id from ids_org)
   and b.seller_id is not null
   and b.status = 'confirmed';

set session_replication_role = origin;
analyze;

select 'ordenes' as que, count(*) from sales_order where organization_id = (select id from ids_org)
union all select 'reservas', count(*) from booking where organization_id = (select id from ids_org)
union all select 'cobros', count(*) from payment where organization_id = (select id from ids_org)
union all select 'comisiones', count(*) from commission where organization_id = (select id from ids_org)
union all select 'salidas', count(*) from departure where organization_id = (select id from ids_org)
order by 1;
