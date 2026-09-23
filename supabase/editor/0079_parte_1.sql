-- 0079 · parte 1 de 1 — La bandeja del tour center.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo.
--
-- QUÉ HACE
--  · Un índice para la consulta de la bandeja del socio.
--  · Sustituye la política de lectura de `notification`: hasta ahora la BASE le
--    dejaba a un miembro de un tour center leer la bandeja interna entera de la
--    operadora, y solo el filtro de la aplicación lo impedía.
--
-- NO borra ni cambia ninguna fila.

create index if not exists notification_partner_idx
  on notification (organization_id, partner_id, read_status, created_at desc)
  where partner_id is not null;

comment on column notification.partner_id is
  'El tour center al que va dirigido el aviso (0009, en uso desde 0079). Va a '
  'la EMPRESA y no a cada persona: dentro de un tour center todos los accesos '
  'son iguales por construcción (0073), y así quien entra hoy ve lo de la '
  'semana pasada. `audience_role` se queda nula en estas filas — el check de '
  '0044 solo admite los seis roles internos.';

drop policy if exists tenant_select on public.notification;
create policy tenant_select on public.notification for select
  using (
    organization_id = app.current_org_id()
    and (
      -- El personal interno: sin identificador de socio, ve la bandeja entera.
      app.current_partner_id() is null
      -- Lo de su tour center.
      or partner_id = app.current_partner_id()
      -- Y lo suyo personal, que no lleva socio.
      or user_id = auth.uid()
    )
  );

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tiene que salir UNA fila, con las tres ramas dentro del `using`.
select polname,
       pg_get_expr(polqual, polrelid) as condicion
  from pg_policy
 where polrelid = 'public.notification'::regclass
   and polname = 'tenant_select';
