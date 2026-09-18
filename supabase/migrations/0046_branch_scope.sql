-- ═══════════════════════════════════════════════════════════════════════════
-- 0046 — LA SUCURSAL DE CADA PERSONA
--
-- POR QUÉ
--
-- La pantalla de equipo lleva desde el principio un selector de «Sucursal
-- (opcional)» al crear y editar usuarios. La API lo IGNORA: no existe la
-- columna, no se guarda nada y no acota nada. Es decir, el formulario promete
-- algo que el sistema no hace — que es peor que no ofrecerlo, porque quien lo
-- usa cree que ya separó sus puntos de venta.
--
-- Para una operadora con tres tour centers eso significa que el vendedor del
-- centro A ve, busca y exporta las reservas del centro B, y que su pantalla de
-- caja mezcla cajas que no son suyas.
--
-- QUÉ ES Y QUÉ NO ES
--
-- La sucursal es un alcance ORGANIZATIVO, no la muralla entre empresas. Esa
-- muralla es la RLS por `organization_id` y no se toca aquí. El filtro por
-- sucursal se aplica en la capa de consulta, donde puede ser distinto por
-- tabla: un vendedor de una sucursal sigue necesitando ver el catálogo de
-- productos y los hoteles, que son de toda la empresa.
--
-- Y es OPCIONAL por persona: sin sucursal asignada se sigue viendo todo, que es
-- exactamente lo de hoy. Nadie pierde acceso por esta migración.
-- ═══════════════════════════════════════════════════════════════════════════

alter table organization_memberships
  add column if not exists branch_id uuid references branch(id) on delete set null;

create index if not exists memberships_branch_idx
  on organization_memberships (organization_id, branch_id)
  where branch_id is not null;

-- ── el dato viaja en el token ──────────────────────────────────────────────
--
-- Se añade `branch_id` a las reclamaciones del JWT por la misma razón que
-- `org_id` y `app_role`: si no, cada petición tendría que preguntar por la
-- membresía para saber qué puede ver, y son cientos de peticiones por sesión.
--
-- El resto de la función queda EXACTAMENTE igual que en 0002: se reescribe
-- entera porque `create or replace` lo exige, no porque cambie nada más.
create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  -- AQUÍ ESTUVO EL FALLO, Y POR ESO ESTAS DOS LÍNEAS NO SE TOCAN.
  --
  -- Esta migración se escribió repitiendo el cuerpo pero no la cabecera, y
  -- `create or replace` devuelve a su valor por omisión todo atributo omitido.
  -- El enganche perdió `security definer` sin que nada avisara, y el día que
  -- esta migración llegó a una base de verdad dejó de poderse iniciar sesión.
  -- Ver 0063 y supabase/tests/auth_hook.test.sql.
  security definer
  set search_path = public, app
as $$
declare
  claims  jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid     uuid  := (event->>'user_id')::uuid;
  m       record;
begin
  select mem.role, mem.status, mem.branch_id, org.id as org_id, org.kind, org.tenant_org_id
    into m
    from organization_memberships mem
    join organizations org on org.id = mem.organization_id
   where mem.user_id = uid
     and mem.status = 'active'
   order by mem.is_primary desc, mem.created_at asc
   limit 1;

  if m.org_id is not null then
    claims := claims
      || jsonb_build_object('org_id', coalesce(m.tenant_org_id, m.org_id))
      || jsonb_build_object('app_role', m.role)
      || jsonb_build_object('status', m.status)
      || jsonb_build_object('partner_id',
           case when m.kind = 'partner' then m.org_id else null end)
      -- Nulo cuando la persona no tiene sucursal: entonces ve toda la empresa,
      -- que es el comportamiento de siempre.
      || jsonb_build_object('branch_id', m.branch_id);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;
