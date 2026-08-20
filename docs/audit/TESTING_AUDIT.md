# TESTING_AUDIT.md — Park & Tours

> Fecha: 2026-08-20 · Suite ejecutada: `npx vitest run` → **9 ficheros, 63 tests, 63 ✅, 1,38 s**. `tsc --noEmit --skipLibCheck` → **limpio**.

## Estado

Partiendo de **cero tests** (`AUDIT_REPORT.md`: *"Testing 5/100"*), ahora hay una suite real que se ejecuta rápido, pasa limpia y está integrada en CI. Es un progreso genuino.

Pero la cobertura está **invertida respecto al riesgo**.

| Fichero de test | Tests | Qué cubre |
|---|---:|---|
| `pricing.test.ts` | 9 | Motor de precios — **crítico ✅** |
| `commission-engine.test.ts` | 10 | Motor de comisiones — **crítico ✅** |
| `codes.test.ts` | 4 | Formato de códigos CSPRNG |
| `format.test.ts` | 7 | Utilidades de formato |
| `data-backend.test.ts` | 3 | Selección de flag |
| `supabase/query-translator.test.ts` | 7 | Traductor de filtros — rama **no productiva** |
| `supabase/auth-context.test.ts` | 7 | Contexto JWT — rama **no productiva** |
| `supabase/storage.test.ts` | 6 | Rutas y validación de subida |
| `scripts/migrate/transform.test.mjs` | 9 | ETL de migración |

**23 de 63 tests (37 %) cubren código que no está en producción.** Sólo 19 (`pricing` + `commission-engine`) cubren reglas de negocio críticas del camino vivo.

## Módulos críticos sin ningún test

| Módulo | Líneas | Riesgo |
|---|---:|---|
| `booking-service.ts` | 649 | **Write-path único de ventas.** Saga, compensación, totales, prorrateo |
| `tenant.ts` | ~300 | **Frontera de aislamiento multi-tenant y RBAC** |
| `availability.ts` | 155 | **Guardia contra sobreventa** |
| `resources.ts` | 1 018 | Allowlists de escritura y filtros de 77 recursos |
| `ledger.ts` / `ledger-events.ts` | ~400 | Partida doble |
| `cash.ts` | ~200 | Arqueo de caja |
| `audit.ts` | ~70 | Rastro de auditoría |
| **48 rutas API** | 4 285 | Ninguna tiene test |

> El fichero más crítico del sistema (`tenant.ts` — lo que impide que la empresa A vea los datos de la empresa B) **no tiene una sola aserción**.

## Pirámide

```
        E2E              0        ← ningún flujo de usuario probado
     Integración         0        ← ninguna ruta API, ninguna BD real
   Unitarios           63         ← funciones puras, aisladas
```

No es una pirámide: es una base sin edificio. Los tests actuales prueban **funciones puras** (precio, comisión, formato, traducción) — valiosas, pero es precisamente la parte del código donde la IA acierta con más facilidad. **No hay ni un test que ejerza una transacción, una carrera, una petición HTTP o una frontera de autorización.**

## Tests que faltan, por prioridad de riesgo

### Bloqueantes (deben existir antes de producción)

| # | Test | Qué demuestra | Hallazgo que cubre |
|---|---|---|---|
| 1 | **Aislamiento cross-tenant**: usuario del tenant A intenta leer/escribir cada uno de los 77 recursos del tenant B | La garantía central del producto | `SEC-001`, `tenant.ts` |
| 2 | **Cobertura de RLS**: consulta que falla si alguna tabla con `organization_id` tiene `relrowsecurity = false` | Impide que `DB-001` se repita | `DB-001` |
| 3 | **Concurrencia de cupo**: 2, 10 y 100 clientes por la última plaza | Exactamente 1 éxito, 0 auto-cancelaciones | `BIZ-001` |
| 4 | **Idempotencia de pago**: 2 peticiones concurrentes con la misma `Idempotency-Key` | Un solo pago | `BIZ-004` |
| 5 | **Aislamiento de partner**: usuario `partner` contra los 77 recursos y contra datos de otro partner | Deny-by-default real | `partnerScopeFor` |
| 6 | **Matriz de autorización**: cada rol × cada recurso × cada verbo | Los 77 `writeRole`/`readRole` hacen lo que dicen | `resources.ts` |
| 7 | **Saga**: fallo inyectado en cada paso de `createOrderWithBookings` | Compensación completa, sin plazas retenidas | `BIZ-002` |
| 8 | **Cuadre contable**: N pagos/reembolsos → suma de `ledger_entry` == suma de `payment` | Los libros cuadran | `BIZ-003` |

### Importantes

9. Datos inesperados por endpoint (la tabla de la Fase 5): null, negativos, enums inválidos, cadenas largas, Unicode, JSON malformado.
10. Fallo de dependencia externa: Totalum/Supabase caído, lento, respuesta inválida.
11. Webhook de Stripe: evento duplicado, firma inválida, orden invertido de eventos.
12. `recalculateDeparture` con > 1 000 reservas (`DB-005`) — debe fallar hoy.
13. E2E de los flujos P0: venta en POS → cobro → voucher → check-in; y alta de tenant → onboarding.

### Contract tests (Fase 33)
Ninguno existe. Necesarios para Stripe (webhooks y checkout) y, tras la migración, para el contrato PostgREST.

## Failure testing (Fase 34)

**Cero cobertura.** Ningún test ejercita: base de datos no disponible, timeout de API, timeout del proveedor de pagos, respuesta inválida, webhook duplicado, red lenta, fallo parcial. Dado que `BIZ-005` demuestra que **no hay timeouts en ninguna llamada externa**, es probable que estos escenarios se comporten mal — pero **UNVERIFIED**, porque nadie los ha ejecutado.

## CI

`.github/workflows/ci.yml` está **bien planteado**: install → lint → typecheck → tests → build → guard de secretos, en `push a main` y en cada PR.

Le falta:
- ❌ `npm audit` (fallaría hoy: 3 críticas — ver `DEPENDENCY_AUDIT.md`)
- ❌ Aplicación de migraciones contra un Postgres efímero
- ❌ Tests de integración con base de datos
- ❌ E2E (Playwright)
- ❌ Umbral de cobertura sobre los módulos críticos
- ❌ Análisis estático de seguridad (CodeQL/Semgrep)
- ❌ Gate de despliegue: **CI verde no bloquea la publicación**, que se hace desde la plataforma Totalum

## Sobre la cobertura

No se persigue el 100 %. La prioridad correcta es la que pide la Fase 32 y es exactamente la que falta:

```
reglas de negocio críticas   → parcial (precio ✅, comisión ✅, cupo ❌, saga ❌)
dinero                       → parcial (comisión ✅, pago ❌, contabilidad ❌)
permisos                     → ❌ CERO
integridad de datos          → ❌ CERO
concurrencia                 → ❌ CERO
```

**Recomendación:** ningún objetivo numérico de cobertura. En su lugar, la regla dura de `AI_TECHNICAL_DEBT.md` `AID-002`: **toda corrección de un P0/P1 entra con un test que falla sin ella.** Es lo único que habría evitado que `enable_tenant_rls()`, `reserve_departure_capacity` y `reconcileStaleDrafts` se dieran por cerradas sin estar conectadas.
