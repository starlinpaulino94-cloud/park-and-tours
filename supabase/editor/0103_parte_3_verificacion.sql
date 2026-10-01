-- ═══════════════════════════════════════════════════════════════════════════
-- 0103 · VERIFICACIÓN — se LEE fila a fila
--
-- Pégalo entero y dale a «Run». No cambia nada: solo lee.
--
-- Qué tienes que ver:
--   · fila 1 → OK. Si dice FALTA, el método `gift_card` no existe en la base y
--              cobrar con tarjeta revienta con un método que la pantalla ofrece.
--   · fila 2 → OK, las dos columnas. Si dice FALTA, la referencia se pierde: el
--              pasivo 2202 no se concilia y el asiento puede duplicarse.
--   · fila 3 → OK, los dos disparadores.
--   · fila 4 → OK, 9 referencias. Si dice FALTA, el disparador del asiento se
--              registró con menos columnas de las que tenía y las que faltan
--              volvieron a quedar SIN comprobar. Es la fila importante.
-- ═══════════════════════════════════════════════════════════════════════════
with metodos as (
  select e.enumlabel as valor
    from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'payment_method'
),
columnas as (
  select c.table_name || '.' || c.column_name as col
    from information_schema.columns c
   where c.table_schema = 'public'
     and (c.table_name, c.column_name) in (('payment','gift_card_id'), ('ledger_entry','gift_card_id'))
),
disparadores as (
  select t.tgname as nombre
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('payment_same_tenant_gift_card', 'ledger_entry_same_tenant_refs')
),
-- Las columnas que el disparador del asiento vigila DE VERDAD, leídas de sus
-- argumentos: es lo único que distingue «existe» de «comprueba las nueve».
refs_asiento as (
  select t.args[i] as columna
    from (
      select string_to_array(encode(tr.tgargs, 'escape'), E'\\000') as args
        from pg_trigger tr
       where tr.tgname = 'ledger_entry_same_tenant_refs'
         and tr.tgrelid = 'public.ledger_entry'::regclass
         and not tr.tgisinternal
    ) t, generate_subscripts(t.args, 1) i
   where i % 2 = 1 and coalesce(t.args[i], '') <> ''
),
esperadas as (
  select unnest(array[
    'cash_session_id', 'expense_id', 'ledger_account_id', 'order_id',
    'payable_id', 'payment_id', 'receivable_id', 'settlement_id', 'gift_card_id'
  ]) as columna
)
select 1 as fila, 'gift_card es un metodo de cobro' as que,
       case when exists (select 1 from metodos where valor = 'gift_card')
            then 'OK'
            else 'FALTA · payment_method solo tiene: ' ||
                 (select string_agg(valor, ', ' order by valor) from metodos)
       end as resultado
union all
select 2, 'de que tarjeta salio el saldo',
       case when (select count(*) from columnas) = 2
            then 'OK · payment y ledger_entry'
            else 'FALTA · solo hay: ' ||
                 coalesce((select string_agg(col, ', ' order by col) from columnas), 'ninguna')
       end
union all
select 3, 'disparadores de inquilino',
       case when (select count(*) from disparadores) = 2
            then 'OK · los dos'
            else 'FALTA · solo hay: ' ||
                 coalesce((select string_agg(nombre, ', ' order by nombre) from disparadores), 'ninguno')
       end
union all
select 4, 'el asiento comprueba sus 9 referencias',
       case when not exists (
              select 1 from esperadas e
               where not exists (select 1 from refs_asiento r where r.columna = e.columna))
            then 'OK · 9 referencias'
            else 'FALTA · sin comprobar: ' ||
                 (select string_agg(e.columna, ', ' order by e.columna)
                    from esperadas e
                   where not exists (select 1 from refs_asiento r where r.columna = e.columna))
       end
order by 1;
