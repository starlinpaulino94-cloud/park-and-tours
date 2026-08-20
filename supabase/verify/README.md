# Verificación del esquema Supabase

## 1. Comprobar tu proyecto real (solo lectura)

Pega `RLS_EXPOSURE_CHECK.sql` en **Supabase Dashboard → SQL Editor → Run**. No modifica nada.

Salida esperada si el esquema está sano:

```
con_rls | sin_rls | expuestas_a_anon
     83 |       0 |                0
```

Cualquier fila en la consulta 1 es una tabla legible/escribible con la anon key.
La consulta 4 lista funciones `SECURITY DEFINER` ejecutables por `anon` — antes de
aplicar `0017` devuelve `reserve_departure_capacity` y `release_departure_capacity`;
después debe salir vacía.

## 2. Reproducir la verificación en local

Las migraciones dependen del entorno de Supabase (roles `anon`/`authenticated`/
`service_role`, esquemas `auth` y `storage`, y los privilegios por defecto sobre
`public`). `supabase_shim.sql` los emula para poder aplicar y probar el esquema en
un Postgres limpio.

```bash
initdb -D /tmp/pg -U postgres -A trust
pg_ctl -D /tmp/pg -o "-k /tmp -p 5433" start

psql -h /tmp -p 5433 -U postgres -f supabase/verify/supabase_shim.sql
for f in supabase/migrations/0*.sql; do
  psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -f "$f" || break
done
psql -h /tmp -p 5433 -U postgres -f supabase/verify/RLS_EXPOSURE_CHECK.sql
```

## Resultados de la verificación del 2026-08-20

Postgres 16, migraciones 0001–0016 aplicadas sobre el shim:

| Comprobación | Resultado |
|---|---|
| 16/16 migraciones aplican | ✅ |
| Cobertura de RLS | ✅ 83/83 tablas, 0 expuestas a `anon` |
| `anon` sin JWT lee `customer` | ✅ 0 filas |
| `authenticated` org=A lee `customer` | ✅ sólo la suya |
| `authenticated` org=A lee filas de B | ✅ 0 filas |
| `authenticated` org=A inserta en B | ✅ `ERROR: violates row-level security policy` |
| `authenticated` org=A borra filas de B | ✅ `DELETE 0` |
| `service_role` (bypass legítimo) | ✅ ve todo |
| **`anon` llama `reserve_departure_capacity` en salida ajena** | ❌ **`true` — reservó 8/10 plazas** |
| **`anon` llama `release_departure_capacity` en salida ajena** | ❌ **liberó las plazas** |

Tras aplicar `0017_rpc_tenant_hardening.sql`:

| Comprobación | Resultado |
|---|---|
| `anon` → `reserve_departure_capacity` | ✅ `permission denied` |
| `anon` → `release_departure_capacity` | ✅ `permission denied` |
| `authenticated` org=B (dueña de la salida) | ✅ reserva OK, `booked_pax` 0→3 |
| `service_role` (webhook / seed / ETL) | ✅ reserva OK, `booked_pax` 3→5 |
| `authenticated` org=A sobre salida de B | ✅ `outside your organization` |
