# INFORME DE AUDITORÍA INTEGRAL — Park & Tours

> **Fase 2** de la auditoría. Sistema SaaS multi-tenant de gestión turística (parques, excursiones, tour operators, tour centers, agencias, DMC, hoteles, revendedores, vendedores independientes).
>
> **Fecha:** 2026-08-20 · **Rama:** `claude/project-comprehensive-audit-uxp38i` · **Método:** lectura del código real + build/typecheck/lint/audit ejecutados. Sin modificar código en esta fase.

---

## Executive Summary

Park & Tours es un ERP turístico ambicioso y **sorprendentemente completo en superficie** (77 recursos, 113 páginas, motores de precios/comisiones/contabilidad/inventario escritos). El código de aislamiento multi-tenant en la capa de datos está **bien diseñado y se usa de forma consistente**: no se encontró ninguna fuga de datos *entre empresas distintas*. El build, el typecheck y el lint pasan limpios.

Sin embargo, **el sistema NO está listo para producción con empresas reales**, por defectos graves y sistémicos:

1. **Escalada de privilegios crítica (P0):** el registro público permite auto-asignarse `role: "superadmin"` → compromiso total de la plataforma y de todos los tenants.
2. **Integridad financiera rota (P0):** el libro contable está escrito pero **desconectado de toda la operación**; las cuentas por cobrar tratan los reembolsos como cobros y aplican el importe completo a varios documentos; los saldos que muestra el sistema **no cuadran ni son reconstruibles**.
3. **Sobreventa de capacidad (P0):** el cálculo de cupos es *check-then-act* sin atomicidad sobre una BD sin transacciones → la última plaza se vende dos veces.
4. **Sin máquina de estados (P0):** el `status` de reservas/comisiones/liquidaciones es un campo de texto editable por CRUD genérico, evadiendo todo el ciclo de vida y sus efectos financieros.
5. **Fuga entre ámbitos dentro del tenant (P1):** un usuario del portal B2B (partner externo) puede leer datos financieros de toda la empresa y de otros partners.

Estos no son 40 bugs independientes: son **~6 causas raíz arquitectónicas** (detalladas al final) que se manifiestan en decenas de síntomas.

### Veredicto de Production Readiness

> **NO — no poner en producción sin correcciones.**
>
> Un sistema que administra dinero, reservas y datos de múltiples compañías no puede desplegarse mientras (a) cualquiera pueda registrarse como superadmin, (b) los saldos financieros no cuadren, (c) la capacidad pueda sobrevenderse y (d) los reembolsos corrompan la deuda. Las correcciones P0/P1 son obligatorias antes de cualquier piloto con dinero real.

---

## Health Score

> Puntuación justificada, no inflada. `/100`.

| Dimensión | Score | Justificación |
|---|---:|---|
| Arquitectura | 55 | Buen patrón multi-tenant y separación por capas, pero motores clave (ledger, aprobaciones, inventario) desconectados y estado financiero como texto editable. |
| Seguridad | 25 | Escalada a superadmin en registro (P0); usuarios desactivados siguen operando; sin rate limiting; clickjacking habilitado. Sin secretos expuestos y sin XSS obvio (suma puntos). |
| Multi-tenancy | 60 | Aislamiento *entre empresas* sólido y forzado en BD. Pierde por fuga *intra-tenant* (portal B2B lee toda la empresa; IDOR en detalle ERP) y escalada de registro que cruza empresas. |
| Base de datos | 30 | Cero unicidad (emails/vouchers/códigos duplicables), sin integridad referencial ni cascadas, sin migraciones, **drift real** (37 tablas del código no existen en el script de schema). |
| Lógica de negocio | 40 | Precios/comisiones bien pensados en aislado, pero el flujo de venta ignora temporada, no aplica topes de descuento/pax, y sin máquina de estados. |
| Finanzas | 20 | Ledger decorativo; receivables corruptas por refunds; comisiones devengadas sin cobro; sin idempotencia de pagos; multimoneda de fachada. Los saldos no cuadran. |
| Frontend | 60 | Base muy consistente (patrón `api.ts` uniforme, toasts solo tras respuesta, skeletons/empty states universales, drawer móvil, `overflow-x` en tablas). Pierde por **cero validación zod**, errores globales silenciados, KPIs monomoneda, deep-link roto, `$0` ante error de API. |
| UX | 50 | Flujos núcleo (POS, reservas, caja) claros, pero **38 módulos read-only** que un empleado nuevo no sabrá por qué están vacíos, edición del mismo dato bloqueada en un sitio y abierta en otro, y datos demo mezclados con reales. |
| Performance | 40 | Límites altos fijos (1000/5000) sin cursor; N+1 en recálculos; recálculo de cupos trae hasta 1000 bookings por reserva; KPIs calculados en frontend sobre página parcial. |
| Maintainability | 55 | TS estricto pasa, código legible y consistente, pero mucha lógica duplicada de métricas y ~25 módulos incompletos + 12 endpoints muertos. |
| Testing | 5 | No hay tests (unit/e2e) en el repositorio. |
| Production readiness | 15 | Ver veredicto: bloqueadores P0 en seguridad, finanzas y concurrencia. |

---

## Tabla principal de hallazgos

> Severidad: **P0** crítico (dinero/datos/seguridad/corrupción) · **P1** rompe funcionalidad importante · **P2** parcial · **P3** menor · **P4** mejora.
> Prefijos: `AUD-0xx` multi-tenancy/permisos · `AUD-Bxx` reservas/capacidad · `AUD-Fxx` finanzas · `AUD-Sxx` seguridad · `AUD-Dxx` base de datos · `AUD-Uxx` frontend/UX.

### P0 — Críticos

| ID | Área | Problema | Archivo:línea | Solución |
|---|---|---|---|---|
| AUD-001 / S01 | Auth/Multi-tenancy | Registro público permite `role:"superadmin"`, `company_id` ajeno vía mass-assignment (`input:true`) | `src/lib/auth.ts:248-278` | `input:false` en `role/company_id/partner_id/status`; `databaseHooks.before` que valide enum y nunca acepte `superadmin`. |
| AUD-B01 / F35 | Reservas | Overbooking por carrera *check-then-act* sin atomicidad; además ítems de una orden validados antes de crear ninguno | `src/lib/booking-service.ts:79-83,147`; `availability.ts:101-117` | Reserve-then-verify: recalcular tras crear y compensar si `booked>capacity`; o serializar por departure. |
| AUD-B02 / F10 | Reservas/Finanzas | Sin máquina de estados: `status`/`checkin_status` de booking (y commission/settlement) editables libremente por CRUD genérico | `src/lib/resources.ts:235`; `erp/[resource]/[id]/route.ts:23-43` | Quitar `status` de `writable`; transiciones solo por endpoints dedicados con matriz de transiciones. |
| AUD-F15 | Finanzas | El libro de partida doble **nunca se alimenta** de ventas/pagos/comisiones/gastos: contabilidad decorativa | `src/lib/ledger.ts` (solo lo llama `api/ledger/post` manual) | Postear asientos desde cada evento financiero mediante un servicio único. |
| AUD-F21 | Finanzas | Receivables: el pago se aplica **completo a cada** documento y **sin distinguir refund** → un reembolso salda la deuda | `src/app/api/payments/route.ts:108-116` | Signo por `payment_type`, prorrateo por documento, tope al balance. |

### P1 — Altos

| ID | Área | Problema | Archivo:línea | Solución |
|---|---|---|---|---|
| AUD-002 | Multi-tenancy | Portal B2B lee tablas de toda la empresa: filtro `partner` solo cubre 7 tablas y solo en listado | `erp/[resource]/route.ts:44-49` | `readRole` por recurso; denegar por defecto al rol `partner` salvo recursos marcados. |
| AUD-003 | Multi-tenancy | IDOR entre partners en detalle ERP: `tenantFindOne` solo valida `company`, no `partner` | `erp/[resource]/[id]/route.ts:9-21` | `partnerFindOne` que exija `company`+`partner`. |
| AUD-S02 | Seguridad | Usuarios desactivados siguen autenticados (no se comprueba `status`, no se revoca sesión) | `src/lib/tenant.ts:41-91`; `team/route.ts` | En `getTenantContext`, `status!=="active"` → `null`; revocar sesiones al desactivar. |
| AUD-S03 | Seguridad | Sin rate limiting en login/reset/checkin/QR/signup | `src/app/api/**`, `wrangler.jsonc` | Activar rate limit de better-auth y/o binding de Cloudflare. |
| AUD-B03 | Reservas | Doble cancelación → doble reembolso (guard solo bloquea `cancelled`, no `refunded`) | `bookings/[id]/cancel/route.ts:26` | Bloquear estados terminales `["cancelled","refunded","partially_refunded"]`. |
| AUD-B04 | Reservas | Check-in no valida voucher/fecha/re-uso; doble check-in concurrente | `bookings/[id]/checkin/route.ts:25-79` | Validar voucher `valid`+fecha; rechazar si ya `done`; releer tras escribir. |
| AUD-B06 | Reservas | `checkin/lookup`: regex del cliente (ReDoS) y sin rol mínimo → fuga entre partners | `checkin/lookup/route.ts:8-18` | `requireAtLeast(operations)`, escapar regex, filtrar partner. |
| AUD-F01 | Finanzas | La venta ignora temporada/día: precio cotizado ≠ cobrado (`travelDate:null`) | `booking-service.ts:127` | Cargar departure antes y pasar `travelDate`. |
| AUD-F03 / F30 | Finanzas | Multimoneda de fachada: se suman importes de distintas monedas 1:1; `currency_rate` nunca se lee | `booking-service.ts:191-194`; dashboard/hub-stats | Una moneda por empresa o normalizar a `base_amount` con tasa persistida. |
| AUD-F08 | Finanzas | Comisión devengada al crear la reserva; se liquidan comisiones de ventas nunca pagadas | `booking-service.ts:233`; `settlements/generate:33-41` | Elegibilidad condicionada a `booking` pagado/completado. |
| AUD-F09 | Finanzas | Cancelación/refund tras liquidar no revierte comisión ni ajusta settlement | `cancel/route.ts:74-82` | Comisión de reversa negativa en la siguiente liquidación. |
| AUD-F11 | Finanzas | Liquidación no atómica y sin trazabilidad: doble inclusión de la misma comisión | `settlements/generate/route.ts:62-87` | Marcar `settlement` en cada comisión con filtro condicional; total desde las marcadas. |
| AUD-F12 | Finanzas | "Marcar pagada" la liquidación no toca la `payable` → deuda duplicada | `liquidaciones/page.tsx` (markPaid) | Endpoint de pago que salde la payable, registre caja/banco y asiente. |
| AUD-F16 | Finanzas | `post()` del ledger no es atómico: medio asiento persiste; balance editable y con carreras | `ledger.ts:144-174,169-173` | Asiento como documento único; balance derivado, no editable. |
| AUD-F19 | Finanzas | Sin idempotencia en pagos: double-submit = doble cobro | `payments/route.ts` | `Idempotency-Key` por request / unicidad por `reference`. |
| AUD-F20 | Finanzas | Sobrepago y refund sin tope: refund puede exceder lo pagado | `payments/route.ts:27-29` | Cap servidor: pago ≤ balance, refund ≤ pagado−reembolsado. |
| AUD-F22 | Finanzas | Webhook Stripe: handlers vacíos (TODO), firma opcional, checkout sin auth | `stripe/webhook/route.ts:22-107` | Implementar `payment_intent.succeeded` idempotente; exigir secret; autenticar checkout. |
| AUD-F34 | Finanzas | `createOrderWithBookings`: 10+ escrituras sin transacción → órdenes fantasma / receivable ausente | `booking-service.ts:86-301` | Patrón saga: orden `draft` → completar hijos → promover; job de reconciliación. |
| AUD-D01 | Base de datos | Cero constraints de unicidad (emails/vouchers/booking numbers duplicables por diseño) | `scripts/setup-database.mjs`; `fix-property-repeat.mjs` | Unicidad aplicativa atómica; `crypto` en códigos con retry ante colisión. |
| AUD-D03 | Base de datos | Drift: 37 tablas usadas por el código no existen en el script de schema | `resources.ts` vs `setup-database.mjs` | Sincronizar el script con `resources.ts`/`types.ts`; fuente única de schema. |
| AUD-U06 | Frontend | Cero validación zod: 94 campos numéricos aceptan negativos, fechas sin límites, sin control de duplicados | `resource-form.tsx:117`; `resources.ts:815` | Esquemas zod por recurso compartidos cliente/servidor. |
| AUD-U08 | Frontend/Datos | Datos demo ficticios sembrados por defecto en cada tenant real (KPIs inventados) | `onboarding/page.tsx:43`; `api/setup/route.ts:125` | Checkbox opt-in (default off); UI de limpieza; marcar registros demo. |
| AUD-U04 | Frontend/Ops | Cambiar estado de activo desde UI se salta el motor de impacto en cupo → sobreventa | `mantenimiento/activos/page.tsx:58-62` | Cablear la UI a `POST /api/assets/[id]/status`. |

### P2 — Medios (resumen)

| ID | Área | Problema |
|---|---|---|
| AUD-004 | Permisos | Lecturas de negocio sin control de rol: seller/cashier ven KPIs financieros, márgenes, CxC/CxP, comisiones de todos. |
| AUD-005 | Permisos | `stripe/customer-portal` sin auth → IDOR de facturación. |
| AUD-006 | Permisos | Portal summary/catalog: staff no-partner consulta cualquier `partner_id` del query. |
| AUD-007 | Permisos | IDOR de escritura en check-in de participantes (`participant_ids` sin validar pertenencia). |
| AUD-S04 | Seguridad | CSP `frame-ancestors *` + `X-Frame-Options` eliminado → clickjacking (agravado por cookies `SameSite=none`). |
| AUD-S05 | Seguridad | CORS refleja Origin con `Allow-Credentials:true` sobre wildcards de dominios compartidos. |
| AUD-S06 | Seguridad | Filtros ERP con campo del cliente sin allowlist → inyección de operadores tipo Mongo (intra-tenant). |
| AUD-S09 | Seguridad | Contraseñas de 6 chars; sin verificación de email ni recuperación; inconsistencia 6 vs 8 con `/api/team`. |
| AUD-B07 | Reservas | Se puede reservar en salidas pasadas/completadas/dentro del cutoff (cutoff decorativo). |
| AUD-B08 | Reservas | Sin validación de pax (negativos/cero inflan disponibilidad); descuentos sin tope; `max_discount_pct`/`min_pax` no se aplican. |
| AUD-B10 | Reservas | Hard delete sin cascada: huérfanos de tickets/pagos/comisiones (comisión liquidable de reserva inexistente). |
| AUD-B13 | Reservas | Timezones: fechas de negocio con TZ del servidor (Cloudflare/UTC) → horarios desplazados 4-5 h. |
| AUD-F02 | Finanzas | Descuento >100% / importes negativos aceptados. |
| AUD-F04 | Finanzas | Impuesto lo fija el cliente de la API, no `tax_profile`; default 0% (riesgo fiscal). |
| AUD-F05 | Finanzas | `margin_amount` incluye impuestos y tiene código muerto (`*0`). |
| AUD-F23/F24/F25/F27 | Finanzas | Caja: `cash_session` sin validar; refund hardcodeado a `cash`; totales de orden incluyen canceladas; movimientos mal clasificados inflan ventas. |
| AUD-F26 | Finanzas | Página Pagos nunca lista órdenes (usa campos inexistentes `balance_amount`). |
| AUD-F31 | Finanzas | Definiciones de margen/revenue/pendiente incoherentes entre dashboard, reportes y páginas. |
| AUD-D02/D05/D06/D09 | Base de datos | Sin integridad referencial; `user` usa `company_id` (inconsistente); audit sin `company` obligatorio ni before/after; queries sin cursor. |

### P3/P4 — Menores y mejoras

AUD-B05 (códigos `Math.random`), AUD-B09 (generate duplicable), AUD-B12 (pagos/refunds sin tope por seller), AUD-B14/B15/B16, AUD-F06/F07/F13/F14/F17/F18/F28/F29/F32/F33/F37/F38, AUD-S07/S08/S10, AUD-D07/D08/D10.
**Frontend P2-P4:** AUD-U01/U02/U03 (módulos-fachada aprobaciones/contabilidad/inventario), AUD-U05 (webhook Stripe stub), AUD-U07 (38 read-only), AUD-U09 (errores silenciados), AUD-U10/U11 (liquidación/pagos sin guardas), AUD-U12 (deep-link check-in roto), AUD-U13/U14 (`$0` ante error, KPIs monomoneda), AUD-U15 (PII en logs), AUD-U16/U17/U18/U19 (datetime, descuento POS, diálogos sin max-h, filas no accesibles por teclado), AUD-U20/U21/U22/U23/U24. Componentes muertos: 16 componentes shadcn sin import, `src/assets/files.ts` vacío, `src/components/common/` solo `.gitkeep`. Detalle completo en los informes por área.

---

## Análisis por área

### Seguridad
Sin secretos en repo ni historial; `.env` en `.gitignore`; sin XSS obvio; cookies `httpOnly`/`secure`. Pero: escalada a superadmin en registro (P0), usuarios desactivados operativos (P1), sin rate limiting (P1), clickjacking habilitado (P2), CORS amplio con credenciales (P2), contraseñas débiles sin verificación/reset (P2). **59 vulnerabilidades en `npm audit` (2 críticas, 20 altas)**, incluyendo `better-auth ≤1.6.21` (bypass de 2FA, bypass de rate-limit, OAuth state) y SSRF en `@opennextjs/cloudflare`.

### Multi-tenancy
El aislamiento *entre empresas* es correcto y forzado en BD (`tenantQuery` mezcla `company` no sobreescribible; `tenantUpdate` descarta `company` entrante). No se halló fuga cross-company. Los fallos son: (a) el registro deja cruzar empresas por mass-assignment (P0); (b) el rol `partner` (externo B2B) lee toda la empresa y otros partners (P1); (c) las lecturas no tienen RBAC (P2). Causa raíz: RBAC solo cubre escrituras; el aislamiento del partner es un parche de lista blanca, no un modelo.

### Base de datos
Cero unicidad, sin integridad referencial real (refs son strings), sin migraciones, drift de 37 tablas. `user` usa `company_id` mientras el resto usa `company`. Auditoría sin `company` obligatorio ni before/after estructurado.

### Finanzas
El área más comprometida. El ledger existe pero no recibe la operación; los saldos que muestra el sistema (dashboard, deudas, liquidaciones, caja) no deben usarse para decisiones de dinero real. Los documentos base (payments, bookings, commissions con snapshots inmutables) **sí** son buena materia prima: un proceso de reconstrucción nuevo podría rehacer los saldos, pero las cifras agregadas actuales no cuadran.

### Reservas / Capacidad / Tickets
La capacidad **puede sobrevenderse hoy** por 4 vías (carrera, intra-orden, resurrección de estado, edición de capacidad). Los tickets/QR **no son confiables**: el QR es el propio código en claro generado con `Math.random()`, y el check-in no valida el voucher. Positivo: los contadores de disponibilidad se recomputan desde los bookings (cancelar dos veces no libera dos plazas).

### Frontend / UX
La base es **notablemente consistente**: patrón único `{ok,data,error}` sin catches vacíos, toasts solo tras confirmar respuesta, skeletons y empty states en el 100% de tablas, `overflow-x-auto` universal, drawer móvil correcto, breadcrumbs reales, `aria-label` en botones icon-only. Los problemas no son de "spaghetti" sino:

- **Módulos-fachada (P1):** 38 páginas son listados de solo lectura; aprobaciones sin botón de aprobar (AUD-U01), contabilidad e inventario sin UI de escritura (AUD-U02/U03), cambio de estado de activo que se salta el motor de impacto en cupo (AUD-U04, causa de sobreventa).
- **Cero validación zod (AUD-U06, P1):** `zod` solo se usa en 2 rutas Stripe; 94 campos numéricos aceptan negativos, fechas sin límites, sin control de duplicados. La validación es solo `required` en cliente y coerción de tipos en servidor.
- **Datos demo en producción (AUD-U08, P1):** el onboarding siembra datos ficticios (clientes, partners, ventas, comisiones) por defecto en cada empresa real, sin checkbox ni limpieza posterior → KPIs financieros inventados indistinguibles de los reales.
- **Errores silenciados globalmente (AUD-U09, P2):** `GlobalErrorCatcher` hace `stopImmediatePropagation()` también en producción; los errores runtime son invisibles.
- **UX financiera (P2):** paneles muestran `$0.00` ante fallo de API (AUD-U13), KPIs suman monedas distintas (AUD-U14), deep-link de check-in roto (AUD-U12).

---

## Causas raíz sistémicas

> "Si 15 bugs vienen del mismo problema arquitectónico, corrige la causa, no los 15 síntomas."

1. **Los atributos de autorización se tratan como entrada del usuario.** `role/company_id/partner_id` con `input:true` + default `owner`. Raíz de AUD-001/S01/S02/011. → Derivar identidad y ámbito solo en servidor.
2. **RBAC solo cubre escrituras; no existe `readRole`.** Toda GET asume "cualquier usuario del tenant lee todo". Raíz de AUD-002/004. → Autorización de lectura por recurso y rol.
3. **El aislamiento del partner es un parche, no un modelo.** Lista blanca de 7 tablas en un endpoint. Raíz de AUD-002/003/006. → Helper `partnerQuery/partnerFindOne` con doble scope.
4. **Sin transacciones ni idempotencia sobre Totalum.** Todo flujo multi-paso es una secuencia de writes sin compensación. Raíz de AUD-B01/F11/F16/F19/F34/F36. → Saga/outbox, claves idempotentes, saldos derivados en vez de cacheados.
5. **El estado financiero/de negocio es un campo de texto editable.** El CRUD genérico expone `status/paid_total/balance/amount`. Raíz de AUD-B02/F10/F12. → Máquina de estados en endpoints dedicados; sacar estos campos de `writable`.
6. **Contabilidad y multimoneda declarativas, no operativas.** El ledger y `currency_rate/tax_profile` existen como datos pero no participan en ningún cálculo. Raíz de AUD-F15/F03/F04/F30. → Conectar los motores a los flujos.

---

## Respuestas a las preguntas del encargo

| Pregunta | Respuesta |
|---|---|
| ¿Los datos están aislados correctamente? | **Entre empresas: sí.** Dentro del tenant: **no** (portal B2B y lecturas sin RBAC). Y el registro deja cruzar empresas (P0). |
| ¿Los permisos son seguros? | **No.** Escalada a superadmin; RBAC solo en escrituras. |
| ¿Las reservas son confiables? | **Parcial.** Ciclo de vida evadible (sin máquina de estados). |
| ¿La capacidad puede sobrevenderse? | **Sí**, por 4 vías. |
| ¿Los pagos son consistentes? | **No.** Sin idempotencia ni topes; receivables corruptas. |
| ¿Las comisiones se calculan correctamente? | **Parcial.** Devengadas sin cobro, sin reversión tras liquidar, editables. |
| ¿Los saldos financieros cuadran? | **No.** Ledger desconectado; saldos no reconstruibles con las reglas actuales. |
| ¿Los tickets son seguros? | **No.** QR = código en claro con `Math.random()`; check-in no valida voucher. |
| ¿Los partners solo ven sus datos? | **No.** Ven toda la empresa y otros partners. |
| ¿La empresa principal controla su red? | Parcial: jerarquía modelada pero sin topes de crédito ni segregación de funciones. |
| ¿Puede escalar? | Con reservas: límites fijos sin cursor, N+1 en recálculos, KPIs en frontend. |
| ¿Es mantenible? | Razonable (TS estricto, código limpio), pero mucho módulo incompleto y duplicación de métricas. |
| ¿Es observable? | **No.** Sin error monitoring real, logs con PII, sin tracing. |
| ¿Tiene pruebas suficientes? | **No.** Sin tests. |
| ¿Está preparado para producción? | **No — no sin correcciones P0/P1.** |

---

Ver el **plan de corrección por fases** en [`REMEDIATION_PLAN.md`](./REMEDIATION_PLAN.md) y el registro de correcciones en [`FIX_LOG.md`](./FIX_LOG.md).
