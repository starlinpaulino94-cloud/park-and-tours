# Validación final (Fase 6) — Park & Tours

> Re-auditoría **adversarial** del código ya corregido: cuatro verificadores independientes releyeron el código actual e intentaron romper cada corrección, buscando bypasses y regresiones. Este documento consolida sus veredictos y las correcciones adicionales aplicadas a raíz de ellos.
>
> **Fecha:** 2026-08-20 · **Rama:** `claude/project-comprehensive-audit-uxp38i`
> **Comprobación mecánica:** `tsc --noEmit` ✅ · `npm run build` ✅ · `node --check` del schema ✅ · todas las `REF` del schema resuelven ✅ · lint sin errores (1 warning preexistente ajeno).

## Resumen

De ~40 correcciones verificadas, **la gran mayoría se sostienen**. La re-auditoría encontró **9 defectos reales** (regresiones introducidas por las correcciones o correcciones incompletas), **todos corregidos en esta fase**. Quedan limitaciones inherentes a Totalum (sin transacciones/locks) documentadas como tales, no como fallos.

## Veredictos por dominio

### Auth / Permisos / Multi-tenancy
| Ítem | Veredicto |
|---|---|
| AUD-001 (escalada superadmin) | ✅ CONFIRMADO — `input:false`; sin otro camino de escritura de rol; team valida `ASSIGNABLE_ROLES`. |
| AUD-S02 (usuarios desactivados) | ✅ CONFIRMADO — `getTenantContext` re-consulta BD y niega si `status!=="active"` (efecto inmediato; sesión queda inerte, no revocada — documentado). |
| AUD-002/003/004 (portal B2B) | ✅ CONFIRMADO (deny-by-default, detalle valida pertenencia, escrituras denegadas) **+ 2 bugs corregidos** (ver abajo). |
| AUD-006 (partner_id ajeno) | ✅ CONFIRMADO — exige manager. |
| AUD-S06 (regex `q`) | ✅ CONFIRMADO (escape completo). Allowlist de `filter.<campo>`: no implementada (riesgo bajo, no es bypass de autorización). |
| AUD-S03/S09 (rate limit, password) | ✅ CONFIRMADO (rate limit activo, minPassword 8). Verificación de email/reset siguen deshabilitados (documentado). |

### Reservas / Capacidad / Tickets / Check-in
| Ítem | Veredicto |
|---|---|
| AUD-B01 (overbooking) | ✅ CONFIRMADO como **mitigación** — cierra el bypass intra-orden y convierte la sobreventa en "único ganador + error"; la ventana de carrera se **reduce, no se elimina** (Totalum sin locks; posible auto-cancelación mutua o oversell con lecturas stale). Limitación inherente. |
| AUD-F34 (saga) | ✅ CONFIRMADO + **compensación completada** (ver bug 4). |
| AUD-B02 (máquina de estados) | ✅ CONFIRMADO en los 5 recursos **+ `order.status` cerrado** (bug 7). Residual documentado: `access_ticket/membership/gift_card` (sistemas paralelos incompletos). |
| AUD-B03 (doble reembolso) | ✅ CONFIRMADO. |
| AUD-B04/007 (check-in) | ✅ CONFIRMADO (reuse + pertenencia) **+ validación de voucher/fecha añadida** (bug 6). |
| AUD-B06 (lookup) | ✅ CONFIRMADO. |
| AUD-B07 (availability) | ✅ CONFIRMADO. |
| AUD-B08 (pax) / AUD-B05 (codes) | ✅ CONFIRMADO. |

### Pagos / Ledger / Comisiones / Settlements / Moneda
| Ítem | Veredicto |
|---|---|
| AUD-F21 (receivables) | ✅ CONFIRMADO — signo, prorrateo y tope correctos; `paid_amount` no queda negativo. |
| AUD-F19/F20 (idempotencia/topes) | ✅ CONFIRMADO. |
| AUD-F15/F16 (ledger) | ✅ CONFIRMADO — postea desde pago/refund/settlement, best-effort, idempotente por ref; `balance` fuera de writable. |
| AUD-F08 (comisión solo si cobrada) | ✅ CONFIRMADO. |
| AUD-F11/F12 (settlements) | ✅ CONFIRMADO — atómico con re-lectura, pay salda payable + cierra comisiones + asienta. |
| AUD-F30/F03 (moneda) | ✅ CONFIRMADO. |
| AUD-005 (Stripe portal) | ✅ CONFIRMADO. |

### Validación / Base de datos / Stripe
| Ítem | Veredicto |
|---|---|
| AUD-U06 (validación) | ✅ CONFIRMADO reglas **+ falso positivo de inventario corregido** (bug 8). |
| AUD-D01 (unicidad) | ✅ CONFIRMADO. |
| AUD-D03 (drift) | ✅ CONFIRMADO — sin drift, sin duplicados, REF ok, 36 tablas + attendance. |
| AUD-F22 (Stripe webhook) | ✅ CONFIRMADO — firma en prod, idempotencia tras éxito, no-op seguro. |

## Defectos hallados en la validación y corregidos

1. **Partner scoping — `customer` fail-open (P0 potencial):** `customer` estaba en `PARTNER_OWNED_TABLES` mapeado a `field:"partner"`, pero la tabla no tiene esa columna → un partner podía ver **todos los clientes del tenant** (PII) si Totalum ignora filtros desconocidos. **Fix:** quitado de OWNED → 403 (los datos de cliente llegan vía expands de sus bookings).
2. **Partner scoping — fuga de coste (P2):** `product` en `PARTNER_SHARED_TABLES` exponía `base_cost` a usuarios partner vía `/api/erp/product`. **Fix:** quitado de SHARED (el catálogo del partner usa `/api/portal/catalog`, solo precio B2B).
3. **Pagos — `credit_note` incoherente (P1):** se trataba como salida en receivable/ledger pero como **venta positiva** en caja y en `syncOrderTotals`. **Fix:** `credit_note` es salida en todos los caminos.
4. **Cancelación — vector de doble reembolso (P1):** `syncOrderTotals` corría **antes** de crear el pago de reembolso, dejando `paid_total` obsoleto y permitiendo que el tope de la API de pagos aprobara un segundo refund. **Fix:** el pago de reembolso se crea **antes** del sync.
5. **`syncOrderTotals` (P2):** incluía reservas canceladas/reembolsadas en el total y solo detectaba `cancelled` (no `refunded`) como orden muerta. **Fix:** total sobre reservas activas; orden sin reservas activas → `cancelled`.
6. **Saga F34 — compensación incompleta (P2):** ante un fallo, `compensateOrder` dejaba vouchers/comisiones/receivable huérfanos (inflaban KPIs; receivable cobrable a mano). **Fix:** la compensación anula también vouchers, comisiones y la cuenta por cobrar; el voucher gana campo `order` (types + schema).
7. **Check-in B04 — voucher/fecha no validados (P2):** el docstring lo prometía pero el código no lo hacía. **Fix:** se rechaza el check-in si el voucher está cancelado/expirado o la reserva es de una fecha futura (con override `force`; el check-in tardío sigue permitido).
8. **U06 — falso positivo de inventario (P1 funcional):** `quantity/reserved/available` forzados a entero rompían inventario por peso/volumen (kg/l) y negaban stock negativo en almacenes `allows_negative`. **Fix:** retirados de enteros y permitidos negativos.
9. **B02 residual — `order.status` y cachés de receivable (P2):** `order.status` (derivado por `syncOrderTotals`) y `receivable.paid_amount`/`balance` (derivados de pagos) eran editables por CRUD. **Fix:** retirados de `writable`.

## Limitaciones inherentes (no son fallos; documentadas)

- **Concurrencia sin locks:** overbooking (B01), read-modify-write de cachés y la saga (F34) son *best-effort* sobre Totalum, que no tiene transacciones ni locks. La garantía dura requeriría Durable Objects/constraints. La sobreventa silenciosa se convirtió en un evento detectable y compensado, pero la ventana no es cero.
- **Drafts huérfanos:** un crash de proceso duro (no una excepción) entre crear reservas y compensar puede dejar una orden `draft` con reservas `pending_payment` que cuentan como venta. Requiere un **job de reconciliación** (follow-up).

## Follow-ups — estado

**Implementados (Fase 6+):**
- ✅ **`readRole` por recurso** — lecturas financieras vía `/api/erp/*` ahora exigen rol mínimo (cashier para caja/pagos, manager para comisiones/costes/ledger…); partners exentos (regidos por su scope). Cierra el P2.
- ✅ **Allowlist de `filter.<campo>`** en el ERP — los filtros se restringen a campos conocidos; los desconocidos se ignoran.
- ✅ **Reconciliación de drafts huérfanos** — `reconcileStaleDrafts` + endpoint `POST /api/maintenance/reconcile-drafts` (admin, apto para cron).

**Deferidos con fundamento (no son endurecimiento de código, requieren migración o feature de producto):**
- **Agregación en `base_amount`:** `base_amount` ya se puebla correctamente en registros nuevos; cambiar los `_sum` del dashboard exige **backfill** de datos históricos/demo (si no, mostraría ceros). Migración deliberada con acceso a BD, no cambio a ciegas. Tenants de una sola moneda ya son correctos.
- **Normalización de email en signup público:** better-auth 1.3.26 no normaliza el email en el login → bajarlo solo en el alta rompería el login con variantes de mayúsculas. El alta por `/api/team` ya es segura.
- **Ciclo de vida de `access_ticket`/`membership`/`gift_card`, checkout de billing por tenant, reset/verificación de email:** features nuevas con decisiones de producto (motor de redención, mapeo plan↔precio, envío de correos), fuera del alcance de la auditoría.

## Veredicto de Production Readiness — actualizado

> **SÍ CON LIMITACIONES** (antes: NO sin correcciones).
>
> Los bloqueadores P0 originales están cerrados y verificados: escalada a superadmin, ledger conectado, receivables correctas, sin evasión de estados, overbooking mitigado + compensado, tickets con validación de voucher. El sistema es apto para un **piloto controlado** con empresas reales, con estas condiciones: (1) `STRIPE_WEBHOOK_SECRET` configurado y rate-limit respaldado por un binding de Cloudflare en producción; (2) asumir que la garantía de no-sobreventa es best-effort hasta añadir locking; (3) implementar el job de reconciliación de drafts y `readRole` antes de escalar a alto volumen o exponer datos financieros a roles de baja jerarquía. No recomendado aún para operación desatendida a gran escala sin esos follow-ups.
