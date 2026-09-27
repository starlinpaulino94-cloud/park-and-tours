-- 0090 parte 2 de 2 — comprobación. Devuelve CUATRO filas; todas tienen que
-- decir OK. Cualquier otra cosa significa que la parte 1 no llegó entera.

select 'columna message.attachment_scope' as comprueba,
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'message'
            and column_name = 'attachment_scope'
       ) then 'OK' else 'FALTA' end as resultado
union all
select 'manifest cabe en attachment_kind',
       case when pg_get_constraintdef(oid) like '%manifest%'
            then 'OK' else 'FALTA' end
  from pg_constraint where conname = 'message_attachment_kind_check'
union all
select 'manifest_dispatch cabe en message_template.key',
       case when pg_get_constraintdef(oid) like '%manifest_dispatch%'
            then 'OK' else 'FALTA' end
  from pg_constraint where conname = 'message_template_key_check'
union all
-- La que llevaba años mal: el código declara `booking_rescheduled` desde que
-- existe la plantilla de cambio de fecha, y la restricción no lo admitía.
select 'booking_rescheduled cabe en message_template.key',
       case when pg_get_constraintdef(oid) like '%booking_rescheduled%'
            then 'OK' else 'FALTA' end
  from pg_constraint where conname = 'message_template_key_check';
