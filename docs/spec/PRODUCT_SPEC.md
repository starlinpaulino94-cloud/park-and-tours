# PRODUCT_SPEC.md — Park & Tours

> **Fase 1 — Especificación del producto real.** Derivada **del código**, no del README ni de la documentación previa.
> Fecha: 2026-08-20 · Rama: `claude/ai-generated-project-audit-ady3kq`
> Método: inspección de 280 ficheros TS/TSX (34 306 líneas), 48 rutas API, 95 páginas de dashboard, `src/lib/nav.ts`, `src/lib/resources.ts`, `src/lib/types.ts`, 16 migraciones SQL.

> ⚠️ **El README miente.** Dice *"Build a full-stack web application with Next.js and Totalum"* y `package.json` se llama `nextjs-totalum-project`. Es la plantilla del generador. El producto real es un ERP turístico multi-tenant. Todo lo que sigue está verificado contra el código.

---

## 1. Problema

Los operadores turísticos (parques de atracciones, empresas de excursiones, tour operadores, tour centers, agencias, transportistas) gestionan hoy su operación en hojas de cálculo, WhatsApp y cuadernos: cupos de salidas, reservas por canal, comisiones a vendedores y partners B2B, liquidaciones, caja, mantenimiento de activos y seguridad de atracciones.

**Park & Tours es un ERP vertical SaaS multi-tenant** que unifica venta, operación, finanzas y cumplimiento de ese sector en un solo sistema, con portal B2B para revendedores.

## 2. Usuarios

| Actor | Descripción | Evidencia |
|---|---|---|
| **Operador turístico** (tenant) | La empresa cliente que paga la suscripción | `organizations` / tabla `company`, `subscription_status` |
| **Personal interno** | Owner, admin, manager, operaciones, cajero, vendedor | `AppRole` en `src/lib/auth.ts` |
| **Partner B2B** | Revendedor externo (hotel, agencia, tour center) con portal propio | rol `partner`, `/api/portal/*`, `partnerScopeFor()` |
| **Operador de la plataforma** | Superadmin cross-tenant (dueño del SaaS) | rol `superadmin`, `/superadmin/*`, impersonación auditada |
| **Cliente final** | *No tiene login.* Es un registro (`customer`), recibe voucher/QR | tabla `customer`, `voucher_code` |

## 3. Roles y jerarquía

`src/lib/tenant.ts:ROLE_RANK` — jerarquía numérica, no ACL por permiso:

```
superadmin 100 → owner 90 → admin 80 → manager 60 → operations 40 ═ cashier 40 → seller 20 → partner 10
```

`partner` **no es un empleado con menos permisos**: es un actor externo con un modelo de acceso distinto (deny-by-default + scope por `partner_id`). Que comparta el mismo eje numérico que los empleados es una decisión discutible; ver `AI_TECHNICAL_DEBT.md` §Modelo de roles.

## 4. Tipos de empresa soportados

`park`, `excursion_company`, `tour_operator`, `tour_center`, `agency`, `transport`, `mixed_operator`, `other` (`src/lib/types.ts:CompanyType`). El tipo sólo altera **el orden de módulos destacados** (`TYPE_FOCUS` en `/api/setup`), no las capacidades.

## 5. Módulos declarados

`ModuleKey` = `bookings`, `crm`, `commissions`, `settlements`, `payments`, `cash_pos`, `transport`, `pickups`, `operations`, `b2b_portal`, `accounting`, `reports`, `audit`.

⚠️ **`moduleEnabled()` hace fail-open**: si `modules_enabled` está vacío devuelve `true` ("no restriction configured", `tenant.ts`). El *feature gating* por plan no restringe nada por defecto — un tenant de plan básico ve todo. Ver `SEC-012`.

## 6. Casos de uso por dominio

### 6.1 Venta (P0 — mission critical)
- Catálogo: productos, modalidades, categorías, reglas de precio por temporada/canal/partner/vendedor/día de semana, costes, promociones, políticas de cancelación.
- POS presencial (`/dashboard/pos`, 750 líneas) y creación de órdenes multi-producto.
- Cotizaciones → orden. Tickets/accesos. Gift cards, vouchers, membresías.
- **Cálculo canónico:** `src/lib/pricing.ts` (`resolvePrice`) — 9 tests.

### 6.2 Reservas y cupos (P0)
- Salidas (`departure`) con capacidad, cutoff de venta, estados `available/almost_full/full/closed/cancelled/completed`.
- Allotments para partners. Participantes por reserva. Vouchers con código CSPRNG.
- **Guardia canónica:** `src/lib/availability.ts` (`assertCapacity`) — **sin tests**.

### 6.3 Operación (P0/P1)
- Despacho diario, check-in por voucher/QR, pickups y rutas, transporte y asignación de vehículos/personal.

### 6.4 Parque (P1)
- Centro de control, atracciones y estado, zonas, accesos, bitácora, incidentes y acciones, waivers y plantillas, inspecciones y checklists. **Dominio con implicaciones de seguridad física y legal (waivers).**

### 6.5 Finanzas (P0)
- Caja y turnos, pagos/reembolsos/notas de crédito, divisas, cuentas por cobrar y pagar, gastos, facturación, fiscal, plan de cuentas y libro diario (partida doble).
- Comisiones (vendedor/supervisor/partner) y liquidaciones.
- **Cálculo canónico:** `src/lib/commission-engine.ts` (10 tests), `src/lib/ledger.ts`, `src/lib/ledger-events.ts` (**sin tests**).

### 6.6 Comercio/inventario (P2)
- Artículos, existencias, movimientos, almacenes, órdenes de compra, proveedores.

### 6.7 Mantenimiento (P2)
- Activos, fuera de servicio, órdenes de trabajo, planes preventivos, repuestos.

### 6.8 Equipo (P2)
- Personal, certificaciones, turnos, asistencia, documentos y acuses.

### 6.9 Plataforma SaaS (P0)
- Onboarding de tenant (`/api/setup`), planes, suscripción Stripe (checkout, portal, webhook), panel superadmin, impersonación auditada, audit log.

## 7. Datos que maneja

| Clasificación | Datos | Dónde |
|---|---|---|
| **Sensible (PII)** | Nombre, email, teléfono, documento de identidad de clientes y participantes; datos de personal; waivers firmados | `customer`, `participant`, `staff`, `waiver` |
| **Confidencial** | Precios de coste, márgenes, comisiones, deuda B2B, libro diario, caja | `product_cost`, `commission`, `receivable`, `ledger_entry`, `cash_session` |
| **Interno** | Reservas, salidas, incidentes, mantenimiento | `booking`, `departure`, `incident`, `work_order` |
| **Público** | Catálogo B2B expuesto al partner | `/api/portal/catalog` |

**Nota de privacidad:** no existe política de retención, borrado ni export de datos personales en el código. Ver `SECURITY_AUDIT.md` §Privacidad.

## 8. Operaciones críticas (dónde se puede perder dinero o datos)

| # | Operación | Riesgo si falla | Estado |
|---|---|---|---|
| 1 | Reserva de la última plaza | **Sobreventa** → cliente sin plaza en destino | ⚠️ Mitigado, no resuelto (`BIZ-001`) |
| 2 | Cobro / reembolso | Doble cargo, saldo incorrecto | ⚠️ Idempotencia best-effort (`BIZ-004`) |
| 3 | Asiento contable del cobro | Libros que no cuadran, silenciosamente | ⚠️ Best-effort (`BIZ-005`) |
| 4 | Liquidación a partner | Pago duplicado o de menos | ✅ Atómico con re-lectura |
| 5 | Creación de orden multi-ítem | Orden fantasma con plazas retenidas | ⚠️ Saga sin barredora activa (`BIZ-002`) |
| 6 | Webhook Stripe | Tenant suspendido o gratis por error | ⚠️ Dedup check-then-act |
| 7 | Impersonación superadmin | Acceso cross-tenant | ✅ Auditado, cookie 2 h |
| 8 | Registro de auditoría | Acción financiera sin rastro | ❌ Fallo silencioso (`SEC-009`) |

## 9. Alcance — estado real

### EXISTE Y FUNCIONA
Venta/POS, reservas y cupos, precios, comisiones, liquidaciones, pagos y caja, check-in, portal B2B, onboarding, suscripción Stripe, audit log, panel superadmin, CRUD genérico de 77 recursos.

### EXISTE PERO INCOMPLETO
- **Backend Supabase** (`DATA_BACKEND=supabase`): esquema completo escrito, **RLS nunca activada** (`DB-001`), RPC atómica **nunca invocada** (`BIZ-001`), sin cutover.
- **Auth Supabase** (`AUTH_BACKEND=supabase`): implementada tras flag, sin migración de usuarios ejecutada.
- **Recuperación de cuenta**: reset de contraseña y verificación de email **comentados** en `auth.ts` (`SEC-006`).
- **Contabilidad**: base caja, sin devengo ni CxC en el mayor.
- **Feature gating por plan**: `moduleEnabled` fail-open.
- **Job de reconciliación**: endpoint existe, **no hay cron** (`BIZ-002`).

### PLANIFICADO (no existe)
Observabilidad (Sentry en `.env.example`, sin código), backups/restore, staging, tests de integración/E2E, pruebas de carga, rate limiting distribuido.

### FUERA DE ALCANCE
Checkout público para cliente final, app móvil, multi-idioma (UI sólo en español), facturación fiscal certificada por país.

## 10. Inventario de funcionalidades (resumen)

| Dominio | Rutas | Estado | Criticidad | Nota |
|---|---|---|---|---|
| Venta / POS | `/dashboard/pos`, `/ventas/*` | WORKING | P0 | `booking-service.ts` es el write-path único |
| Reservas / Salidas | `/dashboard/reservas`, `/salidas` | PARTIAL | P0 | carrera de cupo residual |
| Precios | `/dashboard/productos`, `/precios` | WORKING | P0 | 9 tests |
| Comisiones / Liquidaciones | `/dashboard/comisiones`, `/liquidaciones` | WORKING | P0 | 10 tests |
| Pagos / Caja | `/dashboard/pagos`, `/caja`, `/cobros` | PARTIAL | P0 | idempotencia sin constraint |
| Contabilidad | `/dashboard/contabilidad/*` | PARTIAL | P0 | sólo base caja, best-effort |
| Check-in | `/dashboard/checkin` | WORKING | P0 | rol ≥ operations |
| Portal B2B | `/portal/*`, `/api/portal/*` | WORKING | P1 | deny-by-default verificado |
| Parque | `/dashboard/parque/*` (12 páginas) | PARTIAL | P1 | mayoría CRUD genérico |
| Comercio | `/dashboard/comercio/*` (6) | PARTIAL | P2 | CRUD, sin valoración de stock |
| Mantenimiento | `/dashboard/mantenimiento/*` (6) | PARTIAL | P2 | CRUD |
| Equipo | `/dashboard/equipo/*` (6) | PARTIAL | P2 | CRUD |
| Superadmin | `/superadmin/*` (4) | WORKING | P0 | impersonación auditada |
| Suscripción | `/api/stripe/*` | WORKING | P0 | firma exigida en prod |
| Backend Supabase | `src/lib/supabase/*` | **BROKEN** | P0 | RLS ausente → no apto para cutover |
| Observabilidad | — | **DEAD** | P0 | `instrumentation.ts` no corre en Workers |

**Clasificación:** WORKING 7 · PARTIAL 7 · BROKEN 1 · DEAD 1 · MOCK 0 · UNKNOWN 0.

> No se encontraron datos mock en rutas de producción. Los únicos generadores sintéticos están en `src/lib/demo-seed.ts` (621 líneas), invocado sólo por `/api/setup/demo` con rol ≥ admin y bloqueado si el tenant ya tiene productos. **Los KPIs del dashboard se calculan de datos reales.**
