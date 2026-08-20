# Migración de datos Totalum → Supabase (M5)

ETL idempotente con reconciliación obligatoria. **Sin big-bang**: no se elimina nada de Totalum hasta que la reconciliación cuadre.

## Requisitos
`.env` con: `TOTALUM_API_KEY`, `TOTALUM_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
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
- **`etl.mjs`**: `company`→`organizations(kind='tenant')`; luego cada tabla de `TABLE_SPECS` en orden de dependencias; upsert `onConflict:id`.
- **`reconcile.mjs`**: compara conteos por tabla y **totales financieros** (`sum(payment.amount)`, `sum(booking.total_amount)`, `sum(commission.amount)`) a nivel de centavo. Sale con error ante cualquier discrepancia.

## Pendiente antes de correr en real
`TABLE_SPECS` cubre el núcleo comercial-financiero. Antes del cutover:
1. Extender `TABLE_SPECS` a las tablas restantes (mismo patrón).
2. Cargar `partner`→`organizations(kind='partner')` y `user`→`organization_memberships` **antes** de las tablas que referencian `partner_id` (ver TODO en `etl.mjs`).
3. Migrar los blobs de Totalum (campos FILE) a Supabase Storage y reescribir `TotalumFile.url` → path del bucket.

## Seguridad
- `scripts/migrate/backup/` está en `.gitignore`: **contiene datos de clientes, nunca se commitea**.
- El ETL usa la `service_role` (bypass RLS) — solo en este script server-side, nunca en la app.
