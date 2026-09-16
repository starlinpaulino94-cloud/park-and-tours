-- ═══════════════════════════════════════════════════════════════════════════
-- 0044 — LAS NOTIFICACIONES, VIVAS
--
-- POR QUÉ
--
-- La tabla `notification`, su API y su pantalla existen desde 0009, y en todo
-- este tiempo NINGÚN módulo escribió una sola fila. La campana del menú lleva
-- un contador que siempre dice cero y una bandeja que siempre está vacía: el
-- sistema promete avisar y no avisa de nada. Peor que no tener campana, porque
-- quien la ve vacía concluye que no ha pasado nada.
--
-- QUÉ FALTABA EN EL ESQUEMA
--
--  · A QUIÉN va dirigido un aviso de empresa. Hoy `user_id` nulo significa
--    «para todos», así que el descuadre de caja de anoche le aparecería igual
--    al vendedor que al dueño. `audience_role` guarda el rol MÍNIMO que lo ve.
--  · QUÉ lo provocó. Sin `event_key` y la entidad, dos cosas se vuelven
--    imposibles: no repetir el mismo aviso —un cron que corre cada día
--    escribiría el mismo «cobro vencido» cada día— y saber de dónde salió cada
--    fila cuando alguien pregunta.
-- ═══════════════════════════════════════════════════════════════════════════

alter table notification
  -- Rol mínimo para ver un aviso de empresa (`user_id` nulo). Nulo = todos.
  add column if not exists audience_role text,
  -- Qué hecho lo provocó, del catálogo de `src/lib/notify.ts`.
  add column if not exists event_key text,
  -- Sobre qué fila avisa: permite abrirla y da contexto a quien la lee.
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  -- Lo que identifica al aviso para no repetirlo. Lo compone la aplicación
  -- (`dedupeKeyFor`) porque no siempre es una fila: el aviso de «tu plan va por
  -- el 80 %» se repite una vez AL MES por métrica, y eso no es ninguna entidad.
  add column if not exists dedupe_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notification_audience_role_check') then
    alter table notification add constraint notification_audience_role_check
      check (audience_role is null or audience_role in
        ('owner','admin','manager','operations','cashier','seller'));
  end if;
end $$;

-- ── que no se repita ───────────────────────────────────────────────────────
--
-- Un cron diario que vuelve a mirar las mismas deudas no puede escribir el
-- mismo aviso cada día: a la semana la bandeja tendría siete copias de todo y
-- nadie la miraría más. La clave la arma la aplicación, y aquí la base la hace
-- cumplir — que es la única forma de que dos instancias a la vez no escriban
-- cada una la suya.
--
-- El índice es parcial: los avisos escritos a mano, sin clave, no compiten por
-- ella (en un índice único dos nulos no chocan, pero declararlo parcial lo dice
-- en voz alta y ahorra entradas).
create unique index if not exists notification_dedupe_idx
  on notification (organization_id, dedupe_key)
  where dedupe_key is not null;

-- La consulta de la bandeja: las mías y las de la empresa, lo más nuevo arriba.
create index if not exists notification_audience_idx
  on notification (organization_id, read_status, created_at desc);
