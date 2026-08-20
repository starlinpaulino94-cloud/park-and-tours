# PRODUCTION_READINESS.md — Park & Tours

> Fecha: 2026-08-20 · Rama `claude/ai-generated-project-audit-ady3kq`
> Evidencia ejecutada en este entorno: `npm ci` ✅ · `npx tsc --noEmit --skipLibCheck` ✅ · `npx vitest run` → 63/63 ✅ · `npm audit` → 3 críticas / 20 altas.
> Todo lo no verificable desde el repositorio está marcado **UNVERIFIED**, nunca **PASS**.

---

## Respuesta directa

```
CAN IT GO TO PRODUCTION?

  → NO WITHOUT REMEDIATION
```

**Con matiz importante, porque hay dos preguntas distintas:**

| Pregunta | Respuesta |
|---|---|
| ¿Puede seguir operando **sobre Totalum** en piloto controlado, con pocos tenants y volumen bajo? | **SÍ, con condiciones** — resolviendo `SEC-004`, `SEC-005`, `SEC-003`, `SEC-006`, `SEC-009` y `BIZ-002`, todas baratas |
| ¿Puede hacerse el **cutover a Supabase** hoy? | **No todavía, pero el bloqueador que reporté no existía.** La RLS está activa y verificada (83/83). Lo que falta para el cutover: aplicar `0017` (SEC-002), cablear la RPC de capacidad (`DB-003`), pooling medido y un cutover ensayado |
| ¿Está listo para **producción general** con clientes reales pagando? | **NO.** Sin observabilidad, sin backups probados, sin rollback, sin tests de permisos ni de concurrencia |
| ¿Está validado a la **escala objetivo**? | **NO.** No hay escala objetivo definida y no se han ejecutado pruebas de carga |

### Justificación

Este sistema **no falla por estar mal escrito**. La lógica de dominio es sólida, la separación de capas se respeta, los motores canónicos tienen tests y las correcciones de los ciclos anteriores se sostienen bajo re-lectura adversarial. Ése es un punto de partida mucho mejor que el habitual.

Falla por tres razones, y las tres son categóricas:

1. **Hay una función `SECURITY DEFINER` invocable sin autenticar.** Verificado con exploit: `anon` reservó 8 de 10 plazas de una salida ajena y luego las liberó. Corregido en `0017` y la corrección verificada, pero pendiente de aplicar a tu proyecto.
2. **No se puede operar lo que no se puede ver.** Sin Sentry, sin logs estructurados, sin trazas, sin health check y sin alertas, la pregunta *"si producción falla a las 3:00 AM, ¿sabemos qué pasó?"* tiene una respuesta clara: **no**. Y `writeAudit` puede perder eventos en silencio.
3. **No se puede recuperar lo que no se ha ensayado.** No hay backup verificable por el equipo, no hay restore probado, no hay RPO/RTO, y a la pregunta *"si este despliegue rompe producción, ¿cómo volvemos?"* la respuesta hoy es efectivamente *"pedirle a la IA que lo arregle"* — que es el criterio explícito de **no estar preparado**.

---

## Nivel de madurez

```
CURRENT MATURITY: LEVEL 2 — INTERNAL BETA
```

| Nivel | | Justificación |
|---|---|---|
| 0 — Demo | superado | Hace mucho más que demostrarse |
| 1 — Prototype | superado | Lógica de negocio real y coherente |
| **2 — Internal Beta** | **← aquí** | Utilizable con usuarios controlados que puedan reportar fallos y tolerar incidencias. Los defectos funcionales conocidos están corregidos; los operacionales no |
| 3 — Limited Production | **no alcanzado** | Requiere observabilidad, backups probados y rollback. Sin eso, un fallo con usuarios reales no es detectable ni reversible |
| 4 — Production Ready | no alcanzado | Requiere además tests de permisos/concurrencia y SLO definidos |
| 5 — Production Ready at Target Scale | no alcanzado | **No se han ejecutado pruebas de carga. No puede declararse.** |

---

## Gates de producción

| Gate | Estado | Detalle |
|---|:--:|---|
| **A — Especificación** | ⚠️ **PARCIAL** | Requisitos entendidos y documentados (`PRODUCT_SPEC.md`, este ciclo). Modelo de dominio comprendido. ❌ Falta: capacidad objetivo y SLO no definidos por negocio |
| **B — Build** | ✅ **PASA** | Build ✅ · Typecheck ✅ limpio · Lint ✅ · CI en cada PR · **16/16 migraciones aplican limpio en Postgres 16** |
| **C — Base de datos** | ❌ **FALLA** | **RLS ✅ 83/83, verificada en Postgres real** · Constraints ✅ *en el esquema Postgres, aún sin usar en producción* · Migraciones ⚠️ ficheros sueltos sin herramienta · Índices ⚠️ no justificados por `EXPLAIN` · Backup ❌ · Restore ❌ **nunca probado** · Esquema de producción (Totalum) **no está en el repositorio** |
| **D — Seguridad** | ❌ **FALLA** | Authorization ✅ (77/77 con `writeRole`, partner deny-by-default) · Secretos ✅ (árbol e historial limpios) · Auth ⚠️ (sin reset ni verificación de email; rate limit inoperante) · OWASP ❌ (`SEC-002` exploit verificado, `SEC-004`, `SEC-005`) · Dependencias ❌ (3 críticas) |
| **E — Lógica de negocio** | ✅ **PASA (con reservas)** | Cálculos críticos ✅ (precio y comisión con 19 tests) · Flujos críticos ✅ (saga, topes, prorrateo, signo, snapshots) · Integridad de datos ⚠️ (depende de constraints que no existen en el motor vivo) |
| **F — Concurrencia** | ❌ **FALLA** | Race conditions ❌ **no probadas nunca**; `BIZ-001` documenta carrera residual + auto-cancelación mutua · Idempotencia ⚠️ check-then-act sin constraint (`BIZ-004`) · Transacciones ❌ inexistentes en el motor vivo |
| **G — Testing** | ❌ **FALLA** | Unit ⚠️ 63 ✅ pero **37 % cubre código no productivo** y los módulos críticos (`tenant`, `booking-service`, `availability`) tienen **cero** · Integration ❌ 0 · E2E ❌ 0 · Permisos ❌ 0 · Concurrencia ❌ 0 |
| **H — Fiabilidad** | ❌ **FALLA** | Timeouts ❌ **0 en todo el código** · Retries ❌ · Circuit breaking ❌ · Backpressure ❌ · Backups ❌ · Recovery ❌ · Job de reconciliación ❌ **sin cron** |
| **I — Observabilidad** | ❌ **FALLA** | Logs ❌ 287 `console.*` sin estructura; el logger estructurado **no se ejecuta en Workers** · Métricas ❌ · Errores ❌ sin Sentry · Alertas ❌ · Health check ❌ · Trazas ❌ · Audit trail ⚠️ existe y es bueno pero **falla en silencio** (`SEC-009`) |
| **J — Rendimiento** | ❌ **FALLA** | Load test ❌ **no ejecutado** · Stress ❌ · Rendimiento de consultas ❌ sin `EXPLAIN`, sin acceso a BD · N+1 conocido: ~57 llamadas por venta |
| **K — Despliegue** | ❌ **FALLA** | CI ✅ · Staging ❌ **no existe** · Despliegue reproducible ⚠️ publicación manual desde la plataforma, CI no bloquea · **Rollback ❌ no definido ni probado** |

**Resultado: 2 gates pasan de 11.** Un solo gate crítico en rojo impide producción; hay siete.

---

## Health Score

Cada puntuación con su evidencia. Sin maquillar.

| Dimensión | /100 | Evidencia |
|---|---:|---|
| Specification | **70** | `PRODUCT_SPEC.md` completo derivado del código; falta capacidad objetivo y SLO de negocio |
| Architecture | **60** | Separación de capas real y respetada; `tenant.ts` como punto único de scope. Penaliza el dual-backend simultáneo y el acoplamiento a un BaaS sin transacciones |
| Code Quality | **72** | Typecheck limpio, 0 TODO, 0 `@ts-ignore`, 0 `catch {}`, 0 mocks en producción. Penaliza 482 `any` y `strict: false` |
| Maintainability | **62** | Código legible, comentado y consistente. Penaliza `resources.ts` de 1 018 líneas, vocabulario duplicado y superficie doble |
| Database | **45** | Esquema Postgres bien modelado y **con RLS correcta y verificada** (326 FK, 266 CHECK, 159 índices, 83/83 con RLS). Penaliza: **el motor en producción (Totalum) no tiene ninguna de esas garantías y su esquema no está en el repositorio**; sin backup probado |
| Data Integrity | **45** | Snapshots inmutables ✅, topes y signos ✅, saga con compensación ✅. Penaliza: sin transacciones, sin unicidad, barredora sin cron |
| Security | **58** | RBAC completo y verificado, **RLS verificada en las dos capas**, sin secretos, sin XSS/SQLi, partner deny-by-default. Penaliza: `SEC-002` (exploit verificado), clickjacking, CORS credenciado, 3 CVE críticas |
| Authentication | **40** | Sesión sólida, usuario desactivado pierde acceso al instante, contraseña mín. 8. Penaliza: **sin reset ni verificación de email**, rate limit inoperante, CVE críticas en la librería |
| Authorization | **80** | **El punto más fuerte.** 77/77 recursos con `writeRole`, `READ_ROLE` en datos sensibles, partner deny-by-default en lista y detalle, allowlists de escritura y filtro. Penaliza sólo la ausencia de tests que lo demuestren |
| Performance | **40** | Sin medición posible. ~57 llamadas por venta, agregación en JS, `no-store` global, 4-5 consultas por render de layout |
| Scalability | **35** | Sin colas, sin cache, sin pooling, sin backpressure. Techo estructural en el modelo de acceso a datos |
| Reliability | **25** | **0 timeouts**, 0 retries, 0 circuit breakers, sin cron, sin backups probados |
| Testing | **35** | 63 tests verdes y rápidos en CI (progreso real desde 0). Penaliza: 37 % cubre código no productivo, y 0 tests de permisos, concurrencia, integración o E2E |
| Observability | **12** | `audit_log` de negocio existe y está bien diseñado. Todo lo demás ausente; el logger estructurado no se ejecuta en producción |
| DevOps | **45** | CI correcta y con guard de secretos. Sin staging, sin gate de despliegue, sin migraciones en CI |
| Disaster Recovery | **8** | Sin backup verificable, sin restore probado, sin RPO/RTO, sin rollback, sin plan de incidentes |
| Documentation | **65** | 15 documentos de arquitectura y auditoría, código bien comentado. **Penaliza fuerte que parte afirme garantías falsas** (`AID-003`) |
| **Production Readiness** | **30** | Siete gates críticos en rojo |

---

## Recuento de hallazgos

| Severidad | Nº | IDs |
|---|---:|---|
| **P0** | **2** | `SEC-002`/`DB-002` (RPC ejecutable por `anon` — **exploit reproducido**; corregido en `0017`, pendiente de aplicar) · `SEC-003` (CVE críticas en `better-auth`, coincidentes con esta configuración) |
| ~~retirado~~ | ~~1~~ | ~~`SEC-001`/`DB-001`~~ — **falso**, ver Errata en `README.md` |
| **P1** | **17** | `SEC-004`…`SEC-010` (7) · `DB-003`…`DB-007` (5) · `BIZ-001`…`BIZ-005` (5) |
| **P2** | **13** | `SEC-011`…`SEC-015` · `DB-008`…`DB-012` · `BIZ-006`…`BIZ-009` |
| **P3** | **2** | `SEC-016`, `SEC-017` |

Ver `REMEDIATION_PLAN.md` §Causas raíz.

---

## Lo que este informe NO pudo verificar

Marcado **UNVERIFIED**, nunca como PASS:

- Comportamiento en tiempo de ejecución de cualquier ruta (no hay entorno desplegado accesible).
- Esquema real de Totalum (vive en el panel del proveedor).
- El estado real de **tu** proyecto Supabase. Lo verificado aquí se hizo sobre un Postgres 16 local con tus migraciones 0001–0016 y un shim de los privilegios por defecto de Supabase. Debería coincidir si las aplicaste en orden y sin cambios manuales — confírmalo con `supabase/verify/RLS_EXPOSURE_CHECK.sql`.
- Planes de consulta (`EXPLAIN`), latencias reales y punto de ruptura.
- Política de backups, retención y capacidad de restore de Totalum.
- Configuración de secretos y variables en el entorno de producción.
- SLA y modelo de precios del proveedor de datos.
- Cascadas de borrado sobre tablas financieras (`DB-004`), pendiente de revisión tabla a tabla.
