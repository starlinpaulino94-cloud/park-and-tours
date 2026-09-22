-- ═══════════════════════════════════════════════════════════════════════════
-- 0068 · PARTE 1 de 3 — la tabla de la empresa activa
--
-- Pegar ENTERA en el editor SQL de Supabase y darle a Run. Luego la parte 2.
--
-- Por qué va separada de la parte 2: el editor de Supabase añade por su cuenta
-- un `alter table ... enable row level security` cuando ve un `create table`,
-- y si eso cae dentro de un bloque con $$ revienta con «unterminated
-- dollar-quoted string». Aquí no hay ni un $$, así que no puede pasar.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists user_active_workspace (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  updated_at      timestamptz not null default now()
);

alter table user_active_workspace enable row level security;
alter table user_active_workspace force row level security;

-- Cada quien ve y toca solo su propia fila. Las escrituras de verdad las hace
-- la ruta de cambio de empresa con la llave de servicio; esta política es el
-- cinturón por si algún día se lee desde la sesión.
drop policy if exists active_workspace_self_select on user_active_workspace;
create policy active_workspace_self_select on user_active_workspace
  for select using (user_id = auth.uid());

drop policy if exists active_workspace_self_write on user_active_workspace;
create policy active_workspace_self_write on user_active_workspace
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists user_active_workspace_touch on user_active_workspace;
create trigger user_active_workspace_touch before update on user_active_workspace
  for each row execute function app.touch_updated_at();
