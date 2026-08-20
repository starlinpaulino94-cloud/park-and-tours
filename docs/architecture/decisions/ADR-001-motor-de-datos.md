# ADR-001 — Motor de datos: completar la migración a Postgres

- **Estado:** Propuesta (pendiente de ratificación por el responsable del producto)
- **Fecha:** 2026-08-20
- **Contexto de la decisión:** auditoría `docs/audit/` (segundo ciclo)

## Contexto

La fuente de verdad es **Totalum**, un BaaS propietario sin transacciones, locks de fila, constraints de unicidad, foreign keys, índices controlables ni RLS. Su esquema **no está en el repositorio**: vive en el panel del proveedor.

El proyecto está a mitad de una migración a Supabase/Postgres (M1–M5 completados, cutover no ejecutado). Hoy se paga el coste de mantener dos arquitecturas y no se cobra el beneficio de ninguna.

## Fuerzas

- El producto mueve **dinero y cupos con concurrencia real**.
- Los P1 abiertos (`BIZ-001` sobreventa, `BIZ-004` idempotencia, `BIZ-007` totales) son todos check-then-act. Se mitigaron en el ciclo anterior y las mitigaciones han llegado a su techo.
- El aislamiento multi-tenant depende hoy **exclusivamente** de disciplina en el código de aplicación.
- No hay backup verificable ni restore probado, y no puede haberlo: la gestión es opaca al equipo.
- El modelo de precios del proveedor **no consta**, y una venta hace ~57 llamadas HTTP.

## Opciones consideradas

**A. Completar la migración a Postgres y retirar Totalum.**
**B. Consolidar sobre Totalum y borrar la rama Supabase.**

Análisis comparativo completo en `docs/architecture/CURRENT_ARCHITECTURE.md` §9.

## Decisión

**Opción A**, con una condición innegociable:

> La migración **no puede ejecutarse con el esquema actual**. `app.enable_tenant_rls()` está definida y no se invoca en ninguna de las 77 tablas de negocio (`SEC-001`/`DB-001`). Hacer cutover hoy cambiaría un aislamiento débil pero consistente por **ninguno**, exponiendo los datos de todos los tenants a través de PostgREST con la anon key pública.

Corregir `DB-001` y `DB-002` es **prerrequisito del cutover**, no un paso posterior.

## Consecuencias

**Positivas:** transacciones, locks, FK, UNIQUE, CHECK, índices medibles, RLS como frontera real, migraciones versionadas, backups con PITR, `EXPLAIN`. Resuelve por construcción `BIZ-001`, `BIZ-004`, `BIZ-007` y toda la sección de constraints. Elimina las dos dependencias de mayor riesgo del proyecto (`totalum-api-sdk` y `better-auth`).

**Negativas:** cutover con riesgo de deriva de datos; hay que migrar Auth y Storage a la vez; se descartan las 592 líneas del adapter de better-auth; el pooling de conexiones se convierte en el riesgo operativo nº 1 y debe medirse antes de abrir a usuarios.

**Coste estimado:** 3–5 semanas incluyendo corrección de esquema, cutover ensayado y verificación. El ETL ya está escrito y testeado (`scripts/migrate/`, 9 tests).

## Si se decide lo contrario

Si el negocio ratifica la Opción B, debe hacerse con la constancia explícita de que `BIZ-001`, `BIZ-004`, `BIZ-005` y `BIZ-007` **quedan como riesgo aceptado permanente**, y que el aislamiento multi-tenant no tendrá nunca frontera de base de datos. En ese caso, la rama Supabase debe **borrarse entera** (no dejarse tras un flag), para eliminar la superficie duplicada.
