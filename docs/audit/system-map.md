# Mapa del Sistema — Park & Tours

> Fase 1 de la auditoría integral. Documento de **entendimiento del sistema**: qué módulos existen, qué hacen, qué datos tocan, qué roles acceden y en qué estado real están.
>
> **Fecha:** 2026-08-20 · **Rama:** `claude/project-comprehensive-audit-uxp38i`
> **Alcance:** 113 páginas (`src/app/**/page.tsx`), 46 grupos de endpoints (`src/app/api/**/route.ts`), `src/lib/nav.ts`, `src/lib/resources.ts`, `src/lib/labels-modules.ts`, `project-docs/navigation-architecture.md`.

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15.3 (App Router, React 19) |
| Hosting | Cloudflare Workers vía OpenNext (`@opennextjs/cloudflare`) |
| Base de datos | **Totalum** (backend as a service, CRUD registro-a-registro vía `totalum-api-sdk`) — **sin transacciones multi-documento, sin locks, sin constraints de unicidad** |
| Auth | **better-auth** 1.3.26 con adapter propio sobre Totalum (`src/lib/better-auth-totalum-adapter.ts`) |
| Pagos | Stripe 19 (integración **incompleta** — handlers de webhook vacíos) |
| Validación | Zod 4, react-hook-form |
| UI | Tailwind + shadcn/ui (Radix), sonner (toasts), lucide-react |

## Arquitectura real

El **~80% del panel** se apoya en dos componentes genéricos sobre un API REST genérico `/api/erp/[resource]` que expone **77 recursos** registrados en `src/lib/resources.ts`:

- **`ResourcePage`** (`src/components/tf/resource-page.tsx`) — CRUD completo (lista + formulario + borrado).
- **`SimpleResource`** (`src/components/tf/simple-resource.tsx`) — **solo lectura**; su docstring declara: *"Editing for these modules is intentionally disabled until each one gets its proper form"*.

El aislamiento multi-tenant se fuerza en la capa de datos (`src/lib/tenant.ts`): `tenantQuery/tenantCreate/tenantUpdate/tenantDelete` mezclan `company` de forma no sobreescribible. Los roles (`ROLE_RANK`): superadmin 100 · owner 90 · admin 80 · manager 60 · operations 40 · cashier 40 · seller 20 · partner 10.

## Clasificación de estado — resumen cuantitativo

| Estado | Páginas dashboard | Significado |
|---|---|---|
| **FUNCIONAL** | 48 | Núcleo comercial/operativo/caja + hubs + CRUD ResourcePage. Consulta y escribe datos reales. |
| **PARCIALMENTE FUNCIONAL** | 14 | Solo lectura sobre tablas que sí reciben datos, o duplicado de un CRUD que vive en otra página. |
| **INCOMPLETO** | 25 | Solo lectura sobre tablas que **nada escribe** → siempre vacías (retail/facturación/contabilidad/equipo/fidelización/aprobaciones). |
| **MOCK** | 0 dashboard / 3 páginas + 2 endpoints en `/stripe/*` | Boilerplate de plantilla con datos inventados. |
| **ROTO** | 0 | Ningún 404/500; todos los `href` resuelven. |

**Hallazgo dominante:** el sistema **no tiene módulos MOCK en el dashboard** (todo consulta Totalum). El problema real es que **~25 módulos son listas de solo lectura sobre tablas que ningún flujo escribe** (estarán vacías siempre) y que **tres motores completos están escritos pero desconectados**: aprobaciones (`lib/approvals.ts`), inventario perpetuo (`lib/inventory.ts`) y contabilidad de partida doble (`lib/ledger.ts`).

## Endpoints API — estado

| Endpoint | Métodos | Estado | Nota |
|---|---|---|---|
| `/api/erp/[resource]` (+`/[id]`) | GET/POST/PUT/DELETE | FUNCIONAL | REST genérico sobre 77 recursos. Lectura sin control de rol (ver AUDIT_REPORT AUD-004). |
| `/api/auth/[...all]` | * | FUNCIONAL | Handler crudo de better-auth. **Mass-assignment de `role` (AUD-001, P0).** |
| `/api/setup` | POST | FUNCIONAL | Onboarding: crea empresa + seed. |
| `/api/setup/demo` | POST | **SIN USAR** | Duplica el seed de `/api/setup`. |
| `/api/me` | GET | **SIN USAR** | El shell recibe todo por server components. |
| `/api/company`, `/api/team` | GET/POST/PUT | FUNCIONAL | Configuración. |
| `/api/dashboard`, `/api/pos/context`, `/api/pricing/quote` | GET/POST | FUNCIONAL | |
| `/api/orders`, `/api/payments`, `/api/bookings/[id]/{cancel,checkin}`, `/api/checkin/lookup` | POST/GET | FUNCIONAL | Núcleo transaccional (con defectos financieros/concurrencia — ver AUDIT_REPORT). |
| `/api/departures/generate`, `/api/operations/dispatch` | POST/GET | FUNCIONAL | |
| `/api/cash/{sessions,sessions/[id]/close,movements}` | GET/POST | FUNCIONAL | |
| `/api/commissions/bulk`, `/api/settlements/generate` | POST | FUNCIONAL | |
| `/api/reports/{aging,profitability}` | GET | FUNCIONAL | |
| `/api/portal/{summary,catalog}` | GET | FUNCIONAL | |
| `/api/approvals` (+`/[id]/decide`) | GET/POST | **SIN USAR** | Motor de doble firma escrito, sin UI ni consumidores. |
| `/api/assets/[id]/status` | POST | **SIN USAR** | Impacto en cupos escrito, sin UI. |
| `/api/attractions/status` | POST | **SIN USAR** | "Centro de control" lo declara "para la siguiente iteración". |
| `/api/inventory/{movement,low-stock}` | POST/GET | **SIN USAR** | Inventario perpetuo escrito, sin UI. |
| `/api/ledger/{chart,post,trial-balance}` | POST/GET | **SIN USAR** | Contabilidad escrita, **desconectada de ventas/pagos/gastos**. |
| `/api/stripe/{create-checkout-session,products}` | POST/GET | MOCK | Público sin auth; solo lo usa `/stripe/demo`. |
| `/api/stripe/customer-portal` | POST | **SIN USAR** | Sin auth (IDOR — AUD-005). |
| `/api/stripe/webhook` | POST | INCOMPLETO | Handlers son stubs con `// TODO`; la suscripción SaaS nunca se cierra. |
| `/api/superadmin/{stats,companies,plans,audit,impersonate}` | * | FUNCIONAL | Plataforma. |

## Código muerto (nivel archivo/endpoint)

**12 endpoints sin ningún consumidor:** `/api/approvals` (GET+POST), `/api/approvals/[id]/decide`, `/api/assets/[id]/status`, `/api/attractions/status`, `/api/inventory/movement`, `/api/inventory/low-stock`, `/api/ledger/chart`, `/api/ledger/post`, `/api/ledger/trial-balance`, `/api/me`, `/api/setup/demo`, `/api/stripe/customer-portal`.

**Páginas huérfanas:** `/stripe/demo` (y success/cancel solo alcanzables desde él).

**Dependencias muertas:** `jsonwebtoken`, `bcrypt`, `@types/jsonwebtoken`, `@types/bcrypt` (sin uso en `src/`); `ai`, `pino`/`pino-pretty`, `cookies-next`, `kill-port` a auditar.

## Duplicados de módulo

| Duplicado | Detalle |
|---|---|
| `commission_rule` ×2 | `/dashboard/distribucion/reglas` (lectura) vs pestaña de `/dashboard/comisiones` (CRUD). |
| `access_ticket` ×2 | `/dashboard/ventas/tickets` (lectura) vs `/dashboard/parque/accesos` (CRUD). |
| `pickup_route` ×2 | `/dashboard/operaciones/rutas` (lectura) vs pestaña de `/dashboard/pickups` (CRUD). |
| `hotel` ×2 | `/dashboard/administracion/hoteles` (lectura) vs pestaña de `/dashboard/pickups` (CRUD). |
| `branch`, `product_category`, `product_modality`, `price_rule`, `cancellation_policy`, `cash_register`, `currency_rate` | Página de solo lectura **Y** pestaña CRUD en `/dashboard/configuracion`: el usuario que entra por el menú no puede editar. |
| `/api/setup/demo` | Duplica el seed de `/api/setup`. |

## Mock / Placeholder

- **`/stripe/{demo,success,cancel}`** + `/api/stripe/{create-checkout-session,products}`: boilerplate de plantilla en inglés, con `demo@example.com` hardcodeado (`stripe/demo/page.tsx:71`). Sin enlaces entrantes.
- **`/api/stripe/webhook`**: handlers de suscripción vacíos con `TODO` — el ciclo trial → suscripción no se cierra.
- **`/dashboard/parque/control`**: placeholder declarado ("llega en la siguiente iteración").

## Módulos INCOMPLETOS (solo lectura sobre tablas nunca escritas)

Estos módulos aparentan funcionar pero muestran listas siempre vacías porque **ningún flujo escribe su tabla**: Tareas, Notificaciones, Cotizaciones, Planes de membresía, Allotments, Membresías, Gift cards, Casos, Existencias, Movimientos de stock, Órdenes de compra, Facturación, Fiscal, Plan de cuentas, Libro diario, Certificaciones, Turnos, Asistencia, Documentos, Acuses, Aprobaciones, Integraciones.

## Enlaces rotos

**Ninguno.** Todos los `href` de `nav.ts` (83 ítems + 10 hubs + PORTAL_NAV + SUPERADMIN_NAV) resuelven a un `page.tsx` existente. Los 4 hubs heredados (`/dashboard/{ventas,catalogo,distribucion,mantenimiento}`) redirigen por diseño.

Caso engañoso (no roto): `analitica/reportes/page.tsx:17` enlaza "Resumen de ventas" a `/dashboard/ventas`, que es un redirect al hub Comercial, no a un reporte.

## Discrepancias navegación declarada vs. real

1. El doc dice "86 rutas"; hay 95 `page.tsx` bajo `/dashboard` (113 en total).
2. "Un solo origen por módulo" (§12.4 del doc) **no se cumple** — ver los duplicados arriba.
3. **Gating por plan es decorativo:** `passes()` (`nav.ts:729-735`) solo filtra por módulo si `ctx.modules` es lista no vacía; con `modules_enabled` null/vacío se muestra todo.
4. **Sucursal activa** es contexto de UI sin filtro en consultas (`tenantQuery` no filtra por branch).

## Drift de esquema (verificado independientemente)

**37 tablas** expuestas por `resources.ts` **no existen** en `scripts/setup-database.mjs`: `access_ticket, allotment, approval_request, asset, attraction, attraction_log, certification, document, document_ack, gift_card, gift_card_movement, guest_case, incident, incident_action, inspection, inspection_template, integration, inventory_item, invoice, ledger_account, ledger_entry, maintenance_plan, membership, membership_plan, purchase_order, purchase_order_line, quote, quote_line, shift, stock_level, stock_movement, task, tax_profile, waiver, waiver_template, warehouse, work_order`. En un entorno recién provisionado con ese script, esos endpoints fallan. Ver AUD-D03.
