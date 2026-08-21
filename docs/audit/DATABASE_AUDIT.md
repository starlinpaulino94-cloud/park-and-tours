# Database Audit

Fecha: 2026-08-21.

## Alcance

Supabase migrations, ETL/reconcile, data provider y estado de cutover. No se ejecuto migracion destructiva. El backup `etl --backup` fue ejecutado por solicitud posterior del usuario.

## Estado Verificado

- Migraciones versionadas `0001` a `0017` existen.
- `node scripts/migrate/validate-specs.mjs scripts/migrate/schema-columns.json` paso: 80 tablas.
- `node --check` de scripts de migracion paso.
- Datos migrados previamente fueron reportados reconciliados: pagos 20,362, reservas 23,374, comisiones 3,324.58.

## Hallazgos

### DB-001 — FKs no garantizan aislamiento tenant-aware

Severity: P0. Status: PARTIAL REMEDIATION IN MIGRATION.

Evidence:
- `supabase/migrations/0004_core_catalog_crm.sql` define `departure.product_id references product(id)`.
- `supabase/migrations/0005_core_sales.sql` define `booking` con `organization_id` y FKs simples a `order/product/departure`.
- `src/lib/supabase/data-provider.ts` en modo service-role inyecta `organization_id`, pero no valida relaciones cruzadas.

Impacto: un bug o script con service-role puede crear relaciones cross-tenant validas para Postgres.

Remediacion aplicada: `supabase/migrations/0018_tenant_reference_integrity.sql` agrega triggers tenant-aware para futuras escrituras en tablas criticas. Pendiente: ejecutar en staging/prod y auditar datos historicos antes de convertirlo en constraints validadas.

### DB-002 — RLS no modela roles/capacidades de escritura

Severity: P0.

Evidence:
- `supabase/migrations/0001_init_extensions_helpers.sql` documenta writes gated by app RBAC.
- Politicas write genericas validan tenant, no rol granular.

Impacto: con JWT valido y acceso directo a PostgREST, DB no distingue capacidades de seller/cashier/admin para writes.

Solucion: politicas por rol para tablas sensibles o mutaciones via RPC/server-only.

### DB-003 — RPC atomica de capacidad no esta cableada al flujo principal

Severity: P1.

Evidence:
- RPC `reserve_departure_capacity` existe en `0008_capacity_txn.sql`.
- `spReserveCapacity` existe en `src/lib/supabase/data-provider.ts`.
- No se verifico invocacion en `booking-service.ts`.

Impacto: la proteccion contra sobreventa existe en DB pero no protege el flujo real.

Solucion: integrar reserva de cupo en transaccion/RPC de creacion de booking.

### DB-004 — Participantes/vouchers no estan suficientemente partner-scoped

Severity: P1.

Evidence: `0007_rls_core.sql` habilita algunas tablas como org-scoped y reconoce pendientes partner-owned.

Impacto: partner podria ver objetos derivados de bookings de otros partners si se exponen por API/RLS.

Solucion: politicas `exists` contra booking partner para `participant`, `voucher`, `access_ticket`, `pickup`.

### DB-005 — Restore/DR no probado

Severity: P1.

Evidence:
- Backups ETL JSON existen, pero no equivalen a restore Postgres productivo.
- No hay runbook RPO/RTO verificado.

Impacto: un backup sin restore test no es garantia operativa.

Solucion: ejecutar restore en entorno aislado con conteos/checksums.

### DB-006 — Cutover Supabase incompleto

Severity: P1.

Evidence:
- `src/lib/data-backend.ts` default `totalum`.
- `.env.development` y `.env.production` no tenian `DATA_BACKEND=supabase` activo al verificarse sin mostrar valores.
- `SUPABASE_USE_RLS=true` no activo.

Impacto: la app aun no opera realmente sobre Supabase.

Solucion: staging controlado con `DATA_BACKEND=supabase`, luego Auth/RLS con memberships y JWT claims.

Evidencia adicional: `node scripts/migrate/verify-memberships.mjs` reporto 5 tenant organizations, 20 partner organizations y 0 memberships activas/primarias. Esto bloquea `AUTH_BACKEND=supabase` y `SUPABASE_USE_RLS=true`.

### DB-007 — Indices por tenant requieren EXPLAIN real

Severity: P2.

Evidence: tablas hijas como `participant`/`voucher` tienen `organization_id`; indices deben revisarse por patron real.

Impacto: RLS por tenant puede degradar con volumen.

Solucion: ejecutar `EXPLAIN ANALYZE` en queries criticas con datos reales anonimizados.

## Gate DB

Resultado: NO PASS para produccion completa. Migrations existen y ETL fue reconciliado, pero faltan constraints tenant-aware, restore test, EXPLAIN y cutover Supabase/RLS.
