# Plan de Corrección — Park & Tours

> **Fase 3** de la auditoría. Orden obligatorio: **integridad de datos → seguridad → multi-tenancy → permisos → reservas → pagos → disponibilidad → comisiones → finanzas**, por encima de cualquier problema visual. Dentro de cada fase: **P0 → P1 → P2 → P3**.
>
> Cada corrección sigue el ciclo: identificar → reproducir → solucionar → implementar → probar → regression test → cerrar (registrado en [`FIX_LOG.md`](./FIX_LOG.md)).

## Principio de seguridad de las correcciones

- **No refactor por refactor.** Cada cambio responde a un bug, riesgo, deuda importante, escalabilidad, seguridad o mantenibilidad concretos.
- **Proteger lo que funciona.** El aislamiento multi-tenant de datos, el recálculo de cupos desde bookings, los snapshots inmutables de precio y el flujo de aprobaciones (four-eyes) están **bien** — no romperlos.
- **Backups antes de cambios destructivos de BD.** Ninguna migración destructiva sin plan de rollback. Los cambios de schema de Totalum se hacen aditivos primero.

---

## Fase 0 — Bloqueadores y seguridad (P0)

| ID | Acción | Riesgo del cambio |
|---|---|---|
| **AUD-001/S01** | `input:false` en `role/company_id/partner_id/status` (`auth.ts`); `databaseHooks.user.create/update.before` que valide `role` contra enum y nunca acepte `superadmin`; ignorar `company_id/partner_id` del cliente. | Bajo. La asignación legítima ya es server-side (`/api/setup`, `/api/team`). Verificar que signup y onboarding siguen funcionando. |
| **AUD-B02/F10** | Sacar `status`/`checkin_status` de `writable` en `booking`, `commission`, `settlement`, `payment`, `voucher`, `access_ticket`, `departure` (`resources.ts`). Transiciones solo por endpoints dedicados. | Medio. Verificar que las páginas que hoy editan estado por CRUD tengan endpoint alternativo (cancel/checkin ya existen). |
| **AUD-F21** | En `payments/route.ts`: aplicar signo por `payment_type` (refund = negativo), prorratear por documento, nunca exceder balance. | Medio. Requiere test del prorrateo. |
| **AUD-F15** | Servicio único de "eventos financieros" que postee al ledger desde venta/pago/refund/comisión/gasto. (Grande — puede fasearse: primero conectar pagos y ventas.) | Alto. Es funcionalidad nueva; no debe alterar los flujos existentes, solo añadir asientos. |
| **AUD-B01/F35** | Reserve-then-verify en `booking-service`: recalcular tras crear y compensar si `booked>capacity`; validar total agregado por departure antes del bucle de ítems. | Alto. Núcleo de ventas; test de concurrencia obligatorio. |

## Fase 1 — Datos, multi-tenancy y permisos (P1)

| ID | Acción |
|---|---|
| AUD-S02 | `getTenantContext`: `status!=="active"` → `null`. Revocar sesiones al desactivar en `/api/team`. |
| AUD-S03 | Activar rate limit de better-auth y/o binding Cloudflare para `/api/auth/*`, `/api/checkin/*`. |
| AUD-002/003/004 | Introducir `readRole` por recurso y `partnerFindOne`/filtro `partner` en detalle ERP y endpoints del portal; denegar por defecto al rol `partner`. |
| AUD-D01 | Unicidad aplicativa atómica para email/voucher/booking_number; `crypto.getRandomValues` en `codes.ts` con retry ante colisión. |
| AUD-D03 | Sincronizar `setup-database.mjs` con las 37 tablas faltantes de `resources.ts`. |
| AUD-U06 | Esquemas zod por recurso compartidos cliente/servidor (`min(0)`, enums, fechas). |
| AUD-U08 | Onboarding: `seed_demo` opt-in (default off); marcar/limpiar datos demo. |

## Fase 2 — Reservas, pagos y disponibilidad (P1/P2)

| ID | Acción |
|---|---|
| AUD-B03 | Guard de cancelación bloquea estados terminales. |
| AUD-B04 | Check-in valida voucher `valid`+fecha, rechaza si ya `done`, relee tras escribir. |
| AUD-B06 | `checkin/lookup`: `requireAtLeast(operations)`, escapar regex, filtrar partner. |
| AUD-F19/F20 | Idempotencia y topes en pagos. |
| AUD-B07/B08 | Rechazar salidas pasadas/cutoff; validar pax (enteros≥0), topes de descuento. |
| AUD-U04 | Cablear cambio de estado de activo a `/api/assets/[id]/status`. |

## Fase 3 — Comisiones, ledger y settlements (P1)

AUD-F08 (comisión condicionada a cobro), AUD-F09 (reversión tras liquidar), AUD-F11 (settlement atómico y trazable), AUD-F12 (pago de liquidación salda payable), AUD-F16 (asiento atómico, balance derivado).

## Fase 4 — Partners y operaciones (P2)

AUD-005/006/007 (Stripe portal auth, portal partner_id, check-in participants), AUD-B10 (soft-delete/cascada), AUD-F22 (webhook Stripe).

## Fase 5 — Frontend y UX (P2/P3)

AUD-U01/U02/U03 (conectar motores a UI), AUD-U09 (no silenciar errores en prod), AUD-U10/U11 (guardas de liquidación/pago), AUD-U12/U13/U14 (deep-link, error states, moneda en KPIs), resto de UX.

## Fase 6 — Performance (P2/P3)

AUD-D09 (cursores en vez de límites fijos; recálculo de cupos agregado), AUD-F17/F32 (paginación de trial-balance y KPIs server-side), AUD-S08.

## Fase 7 — Testing y observabilidad (P1 estructural)

- Tests de los flujos críticos: venta completa (seller→booking→payment→ticket→checkin), partner (venta→comisión→settlement), refund (cancel→refund→reversión→ajuste).
- Error monitoring real (Sentry/equivalente), logs sin PII, tracing.
- Actualizar dependencias vulnerables (`better-auth`, `@opennextjs/cloudflare` y las 59 de `npm audit`), eliminar dependencias muertas.

---

## Estrategia de implementación en esta sesión

Comienzo por **Fase 0 (P0)** en el orden que minimiza riesgo de regresión y maximiza impacto de seguridad:

1. **AUD-001** (cerrar la escalada a superadmin) — cambio pequeño, impacto máximo.
2. **AUD-B02/F10** (sacar `status` del CRUD genérico) — cierra múltiples P0/P1 de una vez (causa raíz #5).
3. **AUD-F21** (receivables con signo y prorrateo) — corrección financiera acotada.
4. **AUD-S02** (usuarios desactivados) y **AUD-B03/B06** (guards de cancelación y lookup) — cambios acotados de alto valor.

Los cambios grandes que introducen funcionalidad nueva (conectar el ledger a la operación — AUD-F15, reserve-then-verify con compensación — AUD-B01, servicio de settlements atómico — AUD-F11) se documentan con su diseño y se implementan con cuidado y pruebas, sin romper los flujos que hoy funcionan.
