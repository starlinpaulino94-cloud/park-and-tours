# Business Logic Audit

Fecha: 2026-08-21.

## Flujos Criticos

### BL-001 — Crear orden/reserva no es transaccion atomica end-to-end

Severity: P0/P1.

Evidence:
- `src/lib/booking-service.ts` crea orden, bookings, participantes, vouchers, receivables y comisiones en pasos separados.
- RPC Supabase de cupo existe pero no esta cableada al flujo real.

Impacto: fallos parciales, sobreventa, registros incompletos.

Solucion: transaction/RPC por dominio al migrar a Supabase; compensaciones explicitas mientras siga Totalum.

### BL-002 — Pagos tienen idempotencia best-effort

Severity: P0/P1.

Evidence:
- `src/app/api/payments/route.ts:38-44` reconoce que `reference` no tiene unique DB constraint.
- Check-then-act antes de crear payment.

Impacto: doble pago bajo carrera concurrente.

Solucion: unique constraint/idempotency table y operacion atomica.

### BL-003 — Ledger/posting es best-effort

Severity: P1.

Evidence:
- `src/app/api/payments/route.ts:197-208` llama `postPayment` despues del pago.
- Comentario indica que falla de bookkeeping no bloquea pago.

Impacto: pago registrado sin contabilidad consistente.

Solucion: outbox/evento durable o transaccion donde aplique; reconciliacion de ledger.

### BL-004 — Validacion de relaciones de pago incompleta

Severity: P2.

Evidence:
- Body acepta IDs relacionados en `payments/route.ts:22-28`.
- Creacion usa esos IDs en `route.ts:110-128`.

Impacto: pago asociado a booking/caja/customer incorrecto.

Solucion: validar cada entidad y relacion padre-hijo.

### BL-005 — Precio/comision tienen tests, pero snapshots historicos requieren auditoria

Severity: P2.

Evidence:
- Tests para `pricing` y `commission-engine` existen.
- `booking.price_snapshot` existe en specs.

Impacto: cambios futuros en reglas pueden alterar interpretacion historica si snapshots incompletos.

Solucion: definir campos historicos inmutables: precio vendido, impuesto, comision, tipo de cambio.

### BL-006 — Modulos CRUD no equivalen a workflows completos

Severity: P2.

Evidence:
- `SimpleResource` read-only.
- Muchos modulos parque/comercio/mantenimiento dependen de CRUD generico.

Impacto: producto aparenta cobertura mayor que la funcional.

Solucion: gates funcionales por modulo antes de marcar WORKING.

## Comprehensibility Test

Pagos y reservas no son facilmente seguibles por un nuevo desarrollador porque mezclan validacion, reglas, persistencia y side effects. Si algo falla, los puntos de investigacion son multiples: API route, service, Totalum, cash, ledger, audit.

## Datos Inesperados

Zod no esta aplicado uniformemente. Deben probarse null, negativos, enum invalido, fechas invalidas, strings largos, HTML y duplicados en pagos/reservas/uploads/team.

## Gate Business Logic

NO PASS para produccion completa hasta resolver idempotencia fuerte, transacciones de reserva/pago/caja y ledger consistente.
