-- 0073 · PARTE 0 — qué membresías incumplen ya el cerrojo. NO CAMBIA NADA.
--
-- Ejecutar ANTES de la parte 1. El disparador es `before insert or update`, así
-- que estas filas seguirán funcionando tal cual; lo que fallará es la próxima
-- EDICIÓN de cualquiera de ellas. Es mejor tener la lista ahora que descubrirla
-- el día que un administrador no pueda guardar un cambio de sucursal.
--
-- Lo esperable es cero filas. Si sale alguna, cada una es una de las dos
-- puertas que 0073 cierra, ya abierta en producción.
select
  case when o.kind = 'partner'
       then 'empleado de un tour center con rol interno — VE EL ERP DE LA OPERADORA'
       else 'rol de socio sin tour center — SIN identificador, pasa el ámbito entero'
  end                                   as puerta,
  m.id                                  as membresia,
  m.role                                as rol,
  o.name                                as organizacion,
  o.kind                                as tipo_de_organizacion,
  m.status                              as estado
from organization_memberships m
join organizations o on o.id = m.organization_id
where (o.kind = 'partner' and m.role <> 'partner')
   or (o.kind is distinct from 'partner' and m.role = 'partner')
order by o.kind, m.created_at;
