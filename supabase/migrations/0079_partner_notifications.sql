-- 0079 — La bandeja del tour center, y la política que la respalda.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA COLUMNA YA ESTABA. NADIE LA USABA.
--
-- `notification.partner_id` existe desde 0009 y ni una línea del sistema la
-- escribía ni la leía. La consecuencia: al tour center no se le contaba nada de
-- sus propias ventas — ni la confirmación, ni el cambio de fecha y recogida, ni
-- la cancelación, ni la liquidación emitida, ni su pago. Se enteraba llamando,
-- o por el turista, que sí recibía sus avisos.
--
-- Es la tercera columna de esta fase que promete un vínculo con el socio y no
-- lo cumple, después de `authorized_products` (0077) y `api_key.partner_id`.
--
-- Aquí no hace falta añadir nada: hace falta un índice para la consulta que
-- ahora sí existe, y una política que diga en la BASE lo que la aplicación ya
-- decide.

create index if not exists notification_partner_idx
  on notification (organization_id, partner_id, read_status, created_at desc)
  where partner_id is not null;

comment on column notification.partner_id is
  'El tour center al que va dirigido el aviso (0009, en uso desde 0079). Va a '
  'la EMPRESA y no a cada persona: dentro de un tour center todos los accesos '
  'son iguales por construcción (0073), y así quien entra hoy ve lo de la '
  'semana pasada. `audience_role` se queda nula en estas filas — el check de '
  '0044 solo admite los seis roles internos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Y LA POLÍTICA, EN LA MISMA ENTREGA
--
-- El riesgo transversal del plan lo dice con todas las letras: cada tabla que
-- se abre a un actor nuevo necesita su política en la misma fase. Hasta ahora
-- `notification` tenía solo el aislamiento por empresa, así que la BASE le
-- dejaba a un miembro de un tour center leer la bandeja interna entera de la
-- operadora —el descuadre de caja de anoche incluido— y solo el filtro de la
-- aplicación lo impedía. Una política que contradice a la aplicación es la que
-- alguien cita el día que se discute qué pasó.
--
-- NO se usa `app.can_read_partner` aquí, y es la diferencia que importa: esa
-- función exige que la fila lleve el socio de quien consulta, y los avisos
-- PERSONALES de un miembro del tour center no llevan ninguno. Con ella, el
-- socio dejaría de ver los suyos propios. Las tres ramas de abajo son las
-- mismas tres que decide `puedeMarcar` en la aplicación.
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
