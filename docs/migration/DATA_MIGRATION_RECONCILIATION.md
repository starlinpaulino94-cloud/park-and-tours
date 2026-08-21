# Reconciliacion de datos Totalum -> Supabase

## Resultado
La carga real de datos Totalum -> Supabase fue completada y reconciliada correctamente.

Validaciones confirmadas:
- Todos los conteos comparados coinciden.
- Pagos: 20,362.
- Reservas: 23,374.
- Comisiones: 3,324.58.

## Decisiones aplicadas
- La cuenta actual de Supabase se conserva.
- Los usuarios demo historicos no se migraron a Supabase Auth.
- Las referencias a usuarios demo quedaron en `NULL` para evitar errores de FK.
- `partner` se migro a `organizations(kind='partner')`.
- Las relaciones partner/tenant se cargaron en `organization_relationships`.
- `vehicle` se cargo antes de `departure_resource` para respetar FKs.

## Pendientes de cutover
- Verificar login con la cuenta actual.
- Activar y probar lectura con `DATA_BACKEND=supabase` en entorno controlado.
- Mantener `SUPABASE_USE_RLS` desactivado hasta confirmar `organization_memberships` y claims JWT.
- Decidir si los usuarios demo historicos deben tener membership real en `organization_memberships`; si no deben acceder, no crearla.
