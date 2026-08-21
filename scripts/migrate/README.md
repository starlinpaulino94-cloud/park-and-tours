# Migración de datos Totalum → Supabase (M5)

ETL idempotente con reconciliación obligatoria. **Sin big-bang**: no se elimina nada de Totalum hasta que la reconciliación cuadre.

## Requisitos
`.env`, `.env.development`, `.env.production` o `.env.local` con: `TOTALUM_API_KEY`, `TOTALUM_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
El esquema Supabase debe estar aplicado (`supabase/migrations/*` → `supabase db push`).

## Pasos
```bash
# 1. Backup (dump de Totalum a JSON; NO carga). Los backups NO se commitean.
node scripts/migrate/etl.mjs --backup

# 2. Carga (Extract → Transform → upsert idempotente por uuid determinista)
node scripts/migrate/etl.mjs

# 3. Reconciliación — la migración NO está hecha hasta que esto pase (exit 0)
node scripts/migrate/reconcile.mjs
```

## Cómo funciona
- **`transform.mjs`** (testeado): `toUuid()` = uuid v5 determinista del `_id` de Totalum → las FKs se resuelven re-derivando el uuid del destino, **sin tabla de mapeo**, y el ETL es re-ejecutable. `ynToBool`, `parseJsonMaybe`, `refId`, y `TABLE_SPECS` (por tabla: refs→`*_id`, campos YN→bool, JSON→jsonb).
- **`etl.mjs`**: `company`→`organizations(kind='tenant')`, `partner`→`organizations(kind='partner')`, `organization_relationships`; luego cada tabla de `TABLE_SPECS` en orden de dependencias; upsert `onConflict:id`.
- **`reconcile.mjs`**: compara conteos por tabla, separando tenants, partners y relaciones, y **totales financieros** (`sum(payment.amount)`, `sum(booking.total_amount)`, `sum(commission.amount)`) a nivel de centavo. Sale con error ante cualquier discrepancia.

## Estado de la carga real
La carga Totalum → Supabase terminó correctamente y la reconciliación cuadró: conteos completos, 20,362 pagos, 23,374 reservas y 3,324.58 en comisiones. Ver `docs/migration/DATA_MIGRATION_RECONCILIATION.md`.

## Pendiente antes del cutover de aplicación
1. Confirmar qué usuarios históricos deben existir en Supabase Auth y qué filas necesitan en `organization_memberships`.
2. Validar login con la cuenta actual y el flujo principal de lectura con `DATA_BACKEND=supabase` en un entorno controlado.
3. No activar `SUPABASE_USE_RLS=true` hasta confirmar memberships y claims JWT.
4. Migrar los blobs de Totalum (campos FILE) a Supabase Storage y reescribir `TotalumFile.url` → path del bucket.

## Seguridad
- `scripts/migrate/backup/` está en `.gitignore`: **contiene datos de clientes, nunca se commitea**.
- El ETL usa la `service_role` (bypass RLS) — solo en este script server-side, nunca en la app.
