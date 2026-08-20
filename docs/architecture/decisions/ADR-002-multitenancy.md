# ADR-002 — Aislamiento multi-tenant: defensa en dos capas obligatoria

- **Estado:** Propuesta
- **Fecha:** 2026-08-20

## Contexto

El modelo es un tenant por fila (`company` / `organization_id`). El aislamiento se aplica hoy **sólo en la capa de aplicación**, mediante `src/lib/tenant.ts`, que fusiona el scope al final de cada operación de forma que el llamante no puede sobrescribirlo.

La auditoría verificó que este diseño **funciona y se respeta**: no se encontró ninguna ruta de fuga entre empresas. Pero también encontró que:
- Algunos módulos (`availability.ts`, `booking-service.ts`, `audit.ts`) llaman al SDK **directamente**, saltándose `tenant.ts`. La garantía pasa a depender de la disciplina del autor en cada callsite.
- La RLS del esquema Postgres **sí está activa y verificada** (155 llamadas a `app.enable_tenant_rls`, 83/83 tablas, aislamiento comprobado en Postgres real). La primera versión de este ADR afirmaba lo contrario por un error de verificación; ver la errata en `docs/audit/README.md`.

## Decisión

El aislamiento multi-tenant debe apoyarse en **dos capas independientes**, y ninguna puede ser la única:

1. **Aplicación** — `tenant.ts` como punto de paso obligatorio. Ninguna operación de datos de negocio puede invocar el SDK/cliente directamente.
2. **Base de datos** — RLS activa en **toda** tabla con `organization_id`, con `force row level security`, más las políticas de scope de partner donde exista `partner_id`.

Se añade una tercera restricción, de proceso:

3. **Verificación mecánica** — un gate en CI que falla si alguna tabla con `organization_id` tiene `relrowsecurity = false`, y un test de integración que, con el JWT del tenant A, intente leer filas del tenant B y obtenga cero.

El rol `service_role` (bypass de RLS) queda restringido a flujos cross-tenant legítimos y auditados: superadmin, webhook de Stripe, onboarding/seed, gestión de equipo e impersonación.

## Consecuencias

- Un fallo en una capa deja de ser una brecha.
- El coste es un gate de CI y una migración; el beneficio es que la garantía deja de depender de que nadie se equivoque nunca.
- La UI **no es** ninguna de las dos capas. Ocultar un botón no es autorización, y así debe seguir tratándose.

## Deuda conocida que esta decisión no cubre

El rol `partner` (actor externo) comparte el eje numérico `ROLE_RANK` con los empleados internos. Funciona porque el código lo trata como caso especial en todas partes (deny-by-default), pero es un modelo confuso: un actor externo no es "un empleado con menos permisos". Revisar en un ADR posterior si el volumen de funcionalidad B2B crece.
