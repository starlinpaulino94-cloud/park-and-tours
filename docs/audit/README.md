# Auditoría — segundo ciclo (2026-08-20)

> Auditoría independiente del proyecto tras los ciclos de PR #1 (auditoría + remediación) y PR #2 (migración M1–M5).
> **Principio aplicado (Fase 43):** el implementador no es el único auditor. Las afirmaciones de los ciclos anteriores se re-verificaron contra el código; **cuatro resultaron ser falsas** (ver `AI_TECHNICAL_DEBT.md` `AID-003`).

## Entregables

| # | Documento | Contenido |
|---|---|---|
| 1 | [`../spec/PRODUCT_SPEC.md`](../spec/PRODUCT_SPEC.md) | Qué hace realmente el producto, derivado del código |
| 2 | [`../architecture/SYSTEM_MAP.md`](../architecture/SYSTEM_MAP.md) | Superficie medida: ficheros, rutas, módulos, flujo de petición |
| 3 | [`../architecture/CURRENT_ARCHITECTURE.md`](../architecture/CURRENT_ARCHITECTURE.md) | Arquitectura real + opciones A/B y recomendación |
| 4 | [`AI_TECHNICAL_DEBT.md`](AI_TECHNICAL_DEBT.md) | Deuda específica de código generado por IA |
| 5 | [`DATABASE_AUDIT.md`](DATABASE_AUDIT.md) | Esquema, constraints, RLS, índices, transacciones, backups |
| 6 | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) | OWASP 2025 / ASVS 5.0 / NIST SSDF |
| 7 | [`BUSINESS_LOGIC_AUDIT.md`](BUSINESS_LOGIC_AUDIT.md) | Corrección, concurrencia, idempotencia, validación |
| 8 | [`SCALABILITY_AUDIT.md`](SCALABILITY_AUDIT.md) | Cuellos de botella, escenarios, coste (UNVERIFIED) |
| 9 | [`TESTING_AUDIT.md`](TESTING_AUDIT.md) | Cobertura real vs riesgo |
| 10 | [`DEPENDENCY_AUDIT.md`](DEPENDENCY_AUDIT.md) | Supply chain, CVE, lock-in |
| 11 | [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) | Gates, health score, nivel de madurez |
| 12 | [`REMEDIATION_PLAN.md`](REMEDIATION_PLAN.md) | Causas raíz y plan por fases |

**ADRs:** [`../architecture/decisions/`](../architecture/decisions/) — motor de datos, multi-tenancy, observabilidad, simplicidad.

## Veredicto

```
CURRENT MATURITY:        LEVEL 2 — INTERNAL BETA
PRODUCTION:              NO WITHOUT REMEDIATION
TARGET SCALE VALIDATED:  NO  (sin pruebas de carga ejecutadas)
P0: 3   P1: 17   P2: 13   P3: 2
```

## Documentos de ciclos anteriores (conservados)

`AUDIT_REPORT.md`, `FIX_LOG.md`, `VALIDATION.md`, `PRODUCTION_READINESS_REPORT.md`, `system-map.md`, `REMEDIATION_PLAN_PR1_2026-08.md`, y `../migration/`, `../security/`, `../database/`.

> ⚠️ Varios de estos documentos contienen afirmaciones de garantía **verificadas como falsas** en este ciclo (en particular *"RLS activa desde M1"*). Corregirlos es una tarea de la Fase 1 del plan de remediación.

## Regla de evidencia

Ninguna conclusión de este ciclo se marca `PASS` sin evidencia reproducible de código, base de datos, ejecución, tests, logs o configuración. Lo no comprobable se marca **UNVERIFIED**.

Evidencia ejecutada en este entorno:
```
npm ci                              → exit 0
npx tsc --noEmit --skipLibCheck     → limpio
npx vitest run                      → 63/63 ✅ (9 ficheros, 1,38 s)
npm audit                           → 3 críticas · 20 altas · 33 moderadas · 4 bajas
```
