# Current Architecture — Auditoria Inicial

## Resumen

La arquitectura real es un monolito Next.js App Router con logica de negocio mezclada entre rutas API, `src/lib`, componentes cliente y wrappers de datos. El backend productivo por defecto sigue siendo Totalum. Supabase/Postgres existe como destino migratorio y tiene datos reconciliados, pero no esta activado como fuente unica de aplicacion.

## Diagrama Conceptual Real

```text
User / Partner / Superadmin
  ↓
Next.js App Router pages + client components
  ↓
Route Handlers / Server components / Generic ERP API
  ↓
Mixed business logic in src/lib and API routes
  ↓
tenant.ts wrappers + direct totalumSdk calls + optional Supabase provider
  ↓
Totalum production path by default
  ↓
Supabase/Postgres migration target behind DATA_BACKEND=supabase
```

## Frontend

- Next.js 15 + React 19.
- App Router en `src/app`.
- Componentes UI en `src/components/tf` y recursos generic CRUD.
- Hay componentes grandes: `dashboard/configuracion/page.tsx`, `dashboard/pos/page.tsx`, `components/tf/app-shell.tsx`.

## Backend

- Route Handlers en `src/app/api`.
- CRUD generico ERP en `/api/erp/[resource]`.
- Servicios de dominio en `src/lib`, especialmente `booking-service.ts`, `tenant.ts`, `cash.ts`, `commission-engine.ts`, `pricing.ts`.
- Muchas rutas todavia llaman `totalumSdk` directamente.

## Database

- Produccion/default: Totalum.
- Destino: Supabase Postgres con 17 migraciones.
- ETL/reconcile en `scripts/migrate`.
- Datos migrados y reconciliados documentados en `docs/migration/DATA_MIGRATION_RECONCILIATION.md`.

## Authentication

- Better Auth por defecto, adapter Totalum.
- Supabase Auth existe detras de `AUTH_BACKEND=supabase` y `NEXT_PUBLIC_AUTH_BACKEND=supabase`.
- Reset password/email verification estan comentados en `src/lib/auth.ts`.

## Authorization

- App-level tenancy central en `src/lib/tenant.ts`.
- Roles con ranking en `tenant.ts`.
- Supabase RLS existe, pero `SUPABASE_USE_RLS=true` no debe activarse hasta confirmar memberships/claims.
- Middleware no protege `/api/*`; cada route debe validar auth.

## Storage

- Supabase Storage con buckets `public-assets` y `private-docs`.
- Upload en `/api/storage/upload` deriva path server-side, pero no valida autorizacion sobre entidad/id.

## Cache

- No hay estrategia de cache productiva documentada.
- `next.config.ts` fuerza no-cache global.

## Queue / Workers

- No se detectaron colas ni workers de background.
- Operaciones pesadas/reportes/imports aun no tienen backpressure/async strategy.

## External APIs

- Totalum API SDK.
- Supabase SDK.
- Stripe SDK.
- GitHub solo como repositorio.

## Payments

- Stripe checkout/webhooks existen.
- Pagos operativos internos se registran en `/api/payments` y Totalum.
- Idempotencia de pago es best-effort sin constraint unica.

## Email / Notifications

- Better Auth email reset/verification comentados.
- Modulo notification existe como datos, no se verifico envio real.

## Analytics

- No se encontro analytics productivo formal.

## Infrastructure / Deployment

- Scripts Cloudflare/OpenNext existen.
- Plan documenta migracion futura a Vercel.
- GitHub repo vinculado; `main` protegido exige PR.
- `.github/workflows/ci.yml` existe.

## Observability

- Logs directos `console.log` y helpers parciales.
- No hay Sentry/OpenTelemetry configurado de forma verificada.
- Audit log de negocio existe pero no cubre todos los flujos.

## Deuda Arquitectonica Principal

- No hay separacion clara y consistente entre UI, reglas de negocio, data access e infraestructura.
- El dual backend Totalum/Supabase aumenta riesgo de divergencia.
- El CRUD generico acelera pantallas, pero oculta estados incompletos.

## Opciones De Evolucion

### Opcion A — Modular monolith incremental

Ventajas: menor riesgo, conserva Next.js, permite migrar dominio por dominio, compatible con equipo pequeno.

Desventajas: requiere disciplina para eliminar callsites directos y centralizar reglas.

Complejidad: media.

Riesgo: bajo/medio.

Escalabilidad: suficiente para SaaS operativo con Postgres, RLS, indices y colas selectivas.

### Opcion B — Reescritura por capas estrictas

Ventajas: arquitectura mas limpia al final.

Desventajas: alto costo, alto riesgo, retrasa negocio, probable big-bang.

Complejidad: alta.

Riesgo: alto.

Escalabilidad: buena, pero no demostrada.

## Recomendacion

Adoptar Opcion A: modular monolith primero. Priorizar dominios criticos: auth/tenant, pagos, reservas/cupo, caja, storage, Stripe, audit log.
