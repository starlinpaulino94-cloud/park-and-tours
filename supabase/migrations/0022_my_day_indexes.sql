-- 0022 — Índices para el módulo "Mi día".
--
-- Las consultas del módulo siempre llevan las cuatro columnas juntas:
--   organization_id = :org AND assigned_to_id = :user
--   AND status IN (...) AND due_at <op> :ts   ORDER BY due_at
--
-- Los índices existentes cubren solo parte de eso:
--   task_org_idx      (organization_id, status)   -- 0014
--   task_assigned_idx (assigned_to_id, status)    -- 0014
-- Ninguno incluye el inquilino junto al responsable, ni `due_at`, así que el
-- filtro por fecha y la ordenación se resolvían en memoria. Este índice cubre
-- la consulta completa; no duplica a los anteriores, que siguen sirviendo a los
-- listados por empresa y por responsable sin fecha.
create index if not exists task_my_day_idx
  on task (organization_id, assigned_to_id, status, due_at);

-- Prioridad alta: mismo prefijo de inquilino y responsable, distinta columna
-- final. Sin esto el contador de "Prioridad alta" recorre todas las tareas
-- abiertas de la persona.
create index if not exists task_priority_idx
  on task (organization_id, assigned_to_id, priority)
  where priority in ('high', 'urgent');

-- Aprobaciones decidibles: approval_request_org_idx (organization_id, status)
-- de 0009 ya resuelve el filtro principal. Se añade `expires_at` para que el
-- descarte de expiradas y el barrido de `expireApprovals` no vuelvan a leer la
-- tabla entera.
create index if not exists approval_request_pending_idx
  on approval_request (organization_id, status, expires_at)
  where status = 'pending';
