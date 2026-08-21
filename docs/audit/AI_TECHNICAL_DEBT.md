# AI Technical Debt Audit

Fecha: 2026-08-21.

## Resumen

El proyecto muestra deuda tipica de vibe coding: gran superficie funcional, CRUD generico amplio, tipado permisivo, componentes grandes, reglas dispersas y dualidad Totalum/Supabase. No se recomienda reconstruccion big-bang; se recomienda remediacion por dominios criticos.

## Hallazgos

### AI-001 — Tooling permite deuda severa

Severity: P1.

Evidence:
- `tsconfig.json:7` usa `strict: false`.
- `tsconfig.json:25` usa `noImplicitAny: false`.
- `eslint.config.mjs:16-47` desactiva reglas criticas.
- `next.config.ts:13-15` ignora ESLint durante build.

Impacto: contratos rotos, hooks incorrectos, `any` y codigo muerto pueden llegar a produccion.

Solucion: activar reglas por fases, empezando por dominios P0.

### AI-002 — Uso masivo de `any`

Severity: P2.

Evidence: busqueda encontro aprox. 645 usos de `any` en 109 archivos.

Impacto: el typecheck no protege flujos criticos.

Solucion: DTOs Zod y tipos explicitos en pagos, reservas, caja, auth, storage y superadmin.

### AI-003 — Componentes gigantes mezclan responsabilidades

Severity: P2.

Evidence:
- `src/app/dashboard/configuracion/page.tsx` aprox. 793 lineas.
- `src/app/dashboard/pos/page.tsx` aprox. 751 lineas.
- `src/components/tf/app-shell.tsx` aprox. 695 lineas.

Impacto: baja mantenibilidad y testabilidad.

Solucion: extraer hooks de datos, formularios, tablas y acciones por dominio cuando se toque cada modulo.

### AI-004 — CRUD generico hace parecer completos modulos parciales

Severity: P2.

Evidence:
- `src/components/tf/simple-resource.tsx` declara read-only hasta formularios especificos.
- `src/lib/resources.ts` expone muchos recursos.

Impacto: UI amplia no equivale a flujos operativos validados.

Solucion: inventario por feature con estados WORKING/PARTIAL/MOCK/UNKNOWN y gates por dominio.

### AI-005 — Reglas empresariales dispersas

Severity: P1.

Evidence:
- Pagos: `src/app/api/payments/route.ts` mezcla validacion, idempotencia, caja, receivables, ledger, audit.
- Reservas: `src/lib/booking-service.ts`, `src/lib/availability.ts`, APIs de bookings.
- Direct `totalumSdk` en varios flujos.

Impacto: bugs repetidos, dificil razonar sobre transacciones y partial failures.

Solucion: servicios canonicos por dominio antes de migrar a Supabase completo.

### AI-006 — Logs directos y PII potencial

Severity: P2.

Evidence: aprox. 101 `console.log` en 54 archivos, incluyendo pagos/caja/cancelaciones.

Impacto: observabilidad pobre y posible exposicion de datos.

Solucion: logger estructurado con redaccion y `requestId`.

### AI-007 — Demo/seed en runtime

Severity: P2.

Evidence:
- `/api/setup/demo` ejecuta seed.
- `src/lib/demo-seed.ts` genera datos con `Math.random`.

Impacto: datos demo pueden contaminar tenants reales si se ejecuta accidentalmente.

Solucion: feature flag de entorno, rate limit, confirmacion y audit log fuerte.

## Root Cause

La causa raiz no es un bug puntual: es crecimiento por prompts sin gates estrictos de arquitectura, pruebas, seguridad y ownership por dominio.

## Recomendacion

Adoptar modular monolith incremental. No agregar microservicios. No reescribir todo. Corregir P0/P1 por dominio con tests y revision independiente.
