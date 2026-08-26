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

## Onboarding de usuarios reales (post-ETL)
El ETL cargó los datos de las empresas pero **no** migró usuarios a Supabase Auth
(las referencias a usuarios históricos quedaron en `NULL`). Con RLS activa, un
tenant sin `organization_memberships` falla cerrado: sus usuarios no ven sus datos.
`onboard-user.mjs` cierra ese hueco de forma segura e idempotente — garantiza el
usuario Auth y su membresía activa/primaria, para que el access-token hook inyecte
`org_id` (y `partner_id` si la org es un partner) en el JWT.

```bash
# Ver el estado (solo conteos, sin PII):
node scripts/migrate/verify-memberships.mjs

# Alta de un owner en una empresa (por slug o uuid de la organización):
node scripts/migrate/onboard-user.mjs \
  --email=persona@empresa.com --org=<slug-o-uuid> --role=owner --password='ClaveSegura123!'

# Alternativa sin fijar clave (envía invitación; requiere SMTP en Auth):
node scripts/migrate/onboard-user.mjs --email=persona@empresa.com --org=<slug> --role=owner --invite
```
Roles válidos: `owner|admin|manager|operations|cashier|seller|partner|superadmin`.
Para un usuario **nuevo** se exige `--password` o `--invite` (no se generan claves
en silencio). Re-ejecutar converge (actualiza clave/membresía).

## Seguridad
- `scripts/migrate/backup/` está en `.gitignore`: **contiene datos de clientes, nunca se commitea**.
- El ETL y `onboard-user.mjs` usan la `service_role` (bypass RLS) — solo en scripts server-side, nunca en la app.
- Salida segura: los scripts nunca imprimen contraseñas, tokens ni payloads de filas.
