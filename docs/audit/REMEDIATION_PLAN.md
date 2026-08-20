# REMEDIATION_PLAN.md — Park & Tours

> Fecha: 2026-08-20 · Deriva de `PRODUCTION_READINESS.md`, `SECURITY_AUDIT.md`, `DATABASE_AUDIT.md`, `BUSINESS_LOGIC_AUDIT.md`, `SCALABILITY_AUDIT.md`, `TESTING_AUDIT.md`, `DEPENDENCY_AUDIT.md`, `AI_TECHNICAL_DEBT.md`.
> El plan anterior (PR #1, ya ejecutado) se conserva en `REMEDIATION_PLAN_PR1_2026-08.md`.

## Causas raíz

Los 35 hallazgos **no son 35 problemas**. Son cinco causas y sus síntomas. Corregir síntomas uno a uno es exactamente lo que produjo la deuda que estamos auditando.

### RC-1 — Se escribe la solución, no se conecta ni se verifica
**Síntomas:** `DB-003` (RPC atómica escrita y nunca llamada — un solo `.rpc(` en todo `src/`, dentro de su propia definición) · `BIZ-002` (barredora sin cron: sin `triggers`/`scheduled` en ninguna configuración) · logger que no corre en Workers · Sentry en `.env.example` sin código · reset de contraseña comentado.

> **Nota de autocorrección:** la primera versión encabezaba esta lista con `SEC-001` ("RLS definida, 0 invocaciones"). **Era un error mío de grep**, no un defecto del código: hay 155 invocaciones y la RLS funciona. La causa raíz sigue siendo válida para el resto — pero la lección se amplía: *verificar* también puede fallar, así que la evidencia debe ser **ejecución**, no coincidencia de patrón.
**Causa:** ninguna corrección de P0/P1 llevó un test que fallara sin ella. Escribir la solución y no cablearla es indistinguible de haberla resuelto.
**Cura:** regla de proceso — *ningún P0/P1 se cierra sin un test que falle sin la corrección*. Sin ese test, el estado es `UNVERIFIED`.

### RC-2 — El motor de datos no puede dar las garantías que el dominio necesita
**Síntomas:** `BIZ-001` (sobreventa) · `BIZ-004` (idempotencia) · `BIZ-007` (totales) · `DB-006`/`DB-007` (paginación, N+1) · toda la sección de transacciones.
**Causa:** Totalum no tiene transacciones, locks ni constraints. Cada mitigación en aplicación es check-then-act, y ya han llegado a su techo.
**Cura:** completar la migración a Postgres (Opción A de `CURRENT_ARCHITECTURE.md`). Estos defectos desaparecen por construcción, no por más código.

### RC-3 — El sistema es invisible en producción
**Síntomas:** gate I completo · `SEC-009` (auditoría silenciosa) · `BIZ-003` (contabilidad best-effort sin alerta) · sin health check · sin trazas.
**Causa:** la observabilidad nunca fue un requisito de ninguna fase de generación.
**Cura:** tratarla como funcionalidad P0, no como "mejora".

### RC-4 — No hay red de seguridad operativa
**Síntomas:** sin backups probados · sin rollback · sin staging · sin RPO/RTO · sin cron · sin timeouts · sin circuit breaker.
**Causa:** el despliegue se heredó de la plataforma generadora y nunca se diseñó como operación propia.
**Cura:** pipeline propio con staging, rollback ensayado y restore probado.

### RC-5 — La documentación afirma más de lo que el código hace
**Síntomas:** `AID-003` — tres afirmaciones de garantía que este ciclo no pudo confirmar (RPC conectada, barredora periódica, logger activo).
**Causa:** cada documento describe la intención del incremento, no su verificación.
**Cura:** ninguna afirmación de garantía sin comando reproducible al lado.

---

## Orden de ejecución

Regla: **nada de estética ni de UX mientras haya un P0 abierto.** Cada fase termina con verificación y **revisión independiente** (agente/modelo distinto del que implementó — Fase 43).

---

### FASE 0 — Bloqueadores de seguridad y pérdida de datos

| ID | Acción | Riesgo del cambio | Verificación |
|---|---|---|---|
| **SEC-002 / DB-002** | Aplicar `supabase/migrations/0017_rpc_tenant_hardening.sql`: `revoke execute` a `anon`, comprobación de tenant que falla cerrada, y comprobación añadida a `release_departure_capacity` | Bajo — no toca RLS ni datos; sólo privilegios y dos funciones que la aplicación aún no invoca | **Ya verificado**: exploit bloqueado, y tenant legítimo / `service_role` / tenant ajeno sin regresión |
| **VERIF** | Ejecutar `supabase/verify/RLS_EXPOSURE_CHECK.sql` en el proyecto real para confirmar que coincide con la reproducción local | Nulo — sólo lectura | La propia salida |
| **SEC-003** | Actualizar `better-auth` a versión parcheada; re-verificar `AUD-S02` | Medio — cambio de versión mayor en auth | Test: usuario desactivado no puede operar; login funciona |
| **DEP-1** | Actualizar `next` y `@opennextjs/cloudflare`; **añadir `npm audit --audit-level=high` bloqueante a CI** | Medio | CI verde con el nuevo gate |
| **SEC-004** | `frame-ancestors 'self' https://*.totalum-project.com`; restaurar `X-Frame-Options` fuera del editor visual; añadir `default-src`/`script-src` | Bajo — verificar que el editor visual sigue funcionando | `curl -I` en producción |
| **SEC-005** | Allowlist explícita de orígenes CORS; eliminar el comodín de desarrollo | Bajo | Petición cross-origin desde origen no permitido → sin cabeceras CORS |
| **SEC-009** | `writeAudit` de severidad `critical`/`warning` debe abortar la operación si no puede escribir | Medio — cambia el comportamiento ante fallo | Test con escritura de auditoría inyectada como fallo |
| **BIZ-002** | Cron real para `reconcileStaleDrafts` (`triggers.crons` en `wrangler.jsonc` + handler `scheduled`, iterando tenants) | Bajo | Ejecución observable + registro de auditoría |
| **DR-1** | **Probar un restore completo** en un entorno aparte. Documentar frecuencia, retención, RPO y RTO | Nulo (no toca producción) | Restore verificado con datos comprobados |

**Salida de fase:** revisión independiente + los tests 1, 2 y 5 de `TESTING_AUDIT.md` en verde.

---

### FASE 1 — Arquitectura, base de datos y autenticación

| ID | Acción |
|---|---|
| **DECISIÓN** | Ratificar Opción A (completar migración) o B (consolidar en Totalum). Escribir el ADR. **Todo lo que sigue depende de esta decisión** |
| **DB-008/009** | Adoptar Supabase CLI: migraciones versionadas, con `down`, aplicadas por CI contra Postgres efímero |
| **DB-004** | Revisar tabla a tabla las 39 cascadas; ninguna puede alcanzar `payment`, `ledger_entry`, `commission`, `receivable` ni `audit_log` |
| **DB-013** | `audit_log` insert-only: revocar `update`/`delete` incluso al rol de aplicación |
| **SEC-006** | Activar reset de contraseña y verificación de email + páginas `/forgot-password`, `/reset-password`, `/verify-email` |
| **SEC-007** | Rate limiting distribuido (Cloudflare Rate Limiting o Upstash) en `/api/auth/*`, `/api/checkin/*`, `/api/setup`, `/api/storage/upload` |
| **SEC-010** | Fallar al arrancar si falta `TOTALUM_API_KEY` (patrón de `supabase/service.ts`) |
| **AID-003** | **Corregir la documentación falsa.** `MIGRATION_PLAN.md`, `ARCHITECTURE.md`, `PRODUCTION_READINESS_REPORT.md` |
| **AID-007** | Limpiar herencia de plantilla: `package.json`, `README.md`, `Cache-Control` |

---

### FASE 2 — Lógica de negocio crítica

| ID | Acción |
|---|---|
| **DB-003 / BIZ-001** | Cablear `spReserveCapacity` a `booking-service`; reserva de cupo e inserción del booking en **la misma transacción**. Eliminar el patrón de auto-cancelación |
| **DB-005** | Agregar la ocupación en base de datos (`sum(pax_total) group by status`), no en JavaScript |
| **BIZ-004** | Índice único `(organization_id, reference)` sobre `payment`; capturar la violación como "ya procesado". Mismo patrón en `uniqueCode()` y `stripe_event.event_id` |
| **BIZ-003** | Asiento contable **dentro** de la transacción del pago. Reconciliación periódica `sum(payment)` vs `sum(ledger_entry)` con alerta |
| **BIZ-006/007** | Residuo de redondeo a la última línea; `syncOrderTotals` con lock de fila |
| **BIZ-008/009** | Eliminar los límites fijos de la compensación (`_limit: 50/20`) |
| **VAL-1** | Esquema `zod` en el cuerpo de **cada** ruta API. Entrada inválida → 400 explícito, nunca `null` silencioso |
| **IDEM-1** | `Idempotency-Key` en `POST /api/orders` |
| **SEC-012** | Decidir si `moduleEnabled` debe fallar cerrado y aplicar los límites de plan (`max_users`, `max_bookings_month`) |

---

### FASE 3 — Concurrencia y fiabilidad

| ID | Acción |
|---|---|
| **BIZ-005** | `AbortSignal.timeout()` en toda llamada externa; retry con backoff **sólo en lecturas idempotentes**; circuit breaker sobre el proveedor de datos |
| **CONC-1** | Suite de concurrencia: cupo, pagos, totales de orden, liquidaciones (2 / 10 / 100 clientes) |
| **REL-1** | Colas para liquidaciones, informes, importaciones y emails; degradación controlada (backpressure) |
| **REL-2** | Health check (`/api/health`) que compruebe aplicación, base de datos, storage e integraciones críticas |

---

### FASE 4 — Testing

Ejecutar la lista bloqueante de `TESTING_AUDIT.md`, en ese orden: aislamiento cross-tenant → cobertura de RLS → concurrencia de cupo → idempotencia de pago → aislamiento de partner → matriz de autorización → saga → cuadre contable. Después: datos inesperados, fallo de dependencias, contract tests de Stripe y E2E de los flujos P0.

**CI añade:** migraciones contra Postgres efímero, tests de integración, E2E, CodeQL/Semgrep, y **gate de despliegue** (CI roja no publica).

---

### FASE 5 — Rendimiento

Definir capacidad objetivo y SLO con negocio → colapsar el N+1 (una transacción por venta, inserciones por lote) → arreglar el cacheo de estáticos → pooling medido bajo carga → `EXPLAIN ANALYZE` sobre las consultas críticas y ajustar los 159 índices con evidencia → **entonces** ejecutar k6 (load / stress / spike / soak) y publicar `LOAD_TEST_REPORT.md`.

> Sólo tras esta fase puede evaluarse el Level 5. Antes, no.

---

### FASE 6 — Observabilidad

Sentry (servidor y cliente) → logs estructurados con `request_id`, `user_id`, `organization_id`, operación, duración y resultado, **sin PII** → métricas de negocio (ventas, sobreventas evitadas, fallos de pago, asientos fallidos) → alertas sobre SLO → runbook de incidentes.

---

### FASE 7 — UX y limpieza

Estados de error y reintento consistentes, `zod` en formularios alineado con el servidor, revisión de doble submit, retirada de código muerto (documentado antes de borrar), `GLOSSARY.md` con el modelo canónico y unificación de vocabulario (`AID-004`).

---

## Qué NO hacer

- **No reescribir desde cero.** La lógica de dominio es el activo del proyecto.
- **No hacer cutover antes de la Fase 0.** Falta aplicar `0017`, cablear la RPC de capacidad (`DB-003`) y ensayar el cutover con pooling medido.
- **No sobrearquitectar.** Monolito modular + Postgres. Sin microservicios, Kafka, Kubernetes, event sourcing ni CQRS. Redis sólo si el rate limiting distribuido lo exige.
- **No tocar estética mientras haya un P0.**
- **No cerrar un hallazgo sin un test que falle sin la corrección.** Es la causa raíz RC-1 y es la razón por la que existe este segundo ciclo de auditoría.
