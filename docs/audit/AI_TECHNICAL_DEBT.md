# AI_TECHNICAL_DEBT.md — Park & Tours

> Deuda técnica **específica de código generado por IA**. Fecha: 2026-08-20.
> Este proyecto ha pasado por al menos tres ciclos de generación asistida (PR #1 auditoría+remediación, PR #2 migración M1–M5, y la construcción original). Esta sección busca los patrones que deja ese proceso.

## Lo que este proyecto NO tiene (y suele aparecer en código vibe-coded)

Conviene decirlo primero, porque cambia el diagnóstico. Se buscó agresivamente y **no se encontró**:

| Patrón buscado | Resultado |
|---|---|
| Datos mock en rutas de producción | **0** — los KPIs se calculan de datos reales |
| `Math.random()` en lógica de negocio | **0** — sólo en `demo-seed.ts`; los códigos usan CSPRNG |
| `TODO` / `FIXME` / `HACK` / `NOT_IMPLEMENTED` | **0** en `src/` |
| `@ts-ignore` / `@ts-expect-error` | **0** |
| `catch {}` vacío | **0** |
| Falso éxito en UI (toast antes de la respuesta) | **0** — patrón `api.ts` uniforme |
| Secretos hardcodeados | **0** en árbol e historial |
| Recursos sin control de escritura | **0** de 77 |

Los ciclos de auditoría previos hicieron un trabajo real. **La deuda que queda no es de suciedad superficial, es estructural.**

---

## AID-001 — Arquitectura accidental: dos backends completos simultáneos (P0)

El síntoma más caro. Una migración pedida en un ciclo produjo una **segunda implementación completa** de la capa de datos y de autenticación, que convive con la primera tras banderas de entorno:

| Concepto | Implementación 1 (viva) | Implementación 2 (tras flag) |
|---|---|---|
| Acceso a datos | `tenant.ts` → `totalum-api-sdk` | `tenant.ts` → `supabase/data-provider.ts` |
| Auth | `auth.ts` + `better-auth-totalum-adapter.ts` (592 líneas) | `supabase/auth-context.ts` |
| Contexto de tenant | consulta a BD por petición | claims del JWT |
| Middleware de sesión | cookie better-auth | `supabase/middleware.ts` |
| Esquema | ninguno (vive en el panel del proveedor) | 16 migraciones SQL |
| Capacidad | `availability.ts` (check-then-act) | `reserve_departure_capacity` (**nunca invocada**) |

**Inversión perversa:** el backend que está en producción **no tiene tests**; el que tiene tests (`data-backend.test.ts`, `query-translator.test.ts`, `auth-context.test.ts`, `storage.test.ts` — 23 de los 63 tests) **no está en producción**.

**Coste:** cada cambio de dominio hay que pensarlo dos veces; cualquier corrección aplicada a una rama y no a la otra crea deriva silenciosa; el 100 % del riesgo de la rama Supabase (p. ej. `DB-001`) es invisible porque "no está activo".

**Causa raíz:** ningún ciclo tuvo mandato de *terminar* la migración; cada uno tuvo mandato de *avanzarla*. La IA entrega incrementos, y un incremento nunca es un cutover.

---

## AID-002 — El código escrito y jamás conectado (P1)

Patrón muy característico: la IA implementa la solución correcta, la documenta como cerrada y **no la cablea**.

| Artefacto | Estado | Documentado como |
|---|---|---|
| `reserve_departure_capacity` | Escrita, `spReserveCapacity` **nunca llamada** | *"cierra AUD-B01 overbooking"* |
| `reconcileStaleDrafts` | Escrita, **sin cron que la ejecute** | *"Meant to be run periodically"* |
| `backend-logger.ts` (395 líneas) | Cargada sólo si `NEXT_RUNTIME === 'nodejs'` → **nunca en Workers** | *"ensures logger loads first"* |
| `NEXT_PUBLIC_SENTRY_DSN` | En `.env.example` | Sin ninguna implementación |
| Reset de contraseña / verificación de email | **Comentados** en `auth.ts` | — |

**Ésta es la lección central de la auditoría.** Un informe que dice "corregido" describe *código escrito*, no *comportamiento verificado*. Sin un test que ejecute el camino, escribir la solución y no conectarla es indistinguible de haberla resuelto — hasta producción.

**Antídoto:** cada corrección de un P0/P1 debe llevar un test que **falle sin ella**. Sin ese test, la corrección se marca `UNVERIFIED`, no `PASS`.

---

## AID-003 — Documentación que afirma más de lo que el código hace (P1)

> **Autocorrección.** La primera versión de este apartado encabezaba la lista con *"RLS activa desde M1"* como afirmación falsa. **La afirmación era cierta y mi verificación era defectuosa**: mi grep excluía el punto del nombre cualificado (`'public.customer'`) y reportó 0 sobre 155 llamadas reales. Comprobado después en Postgres real: 83/83 tablas con RLS y aislamiento cross-tenant efectivo. La ironía es instructiva — este apartado acusaba a la documentación previa de afirmar sin verificar, y lo hacía sin verificar.

Con esa entrada retirada, quedan estas discrepancias, todas re-verificadas con patrones amplios o ejecución:

| Afirmación | Fuente | Realidad |
|---|---|---|
| "cierra AUD-B01 overbooking" | `0008_capacity_txn.sql` | La función no se llama — **re-verificado**: un solo `.rpc(` en todo `src/`, dentro de su propia definición |
| "M5 ETL + reconciliación (framework testeado)" | commit `a79532d` | Framework testeado ✅, migración no ejecutada |
| "run periodically (cron)" | `booking-service.ts` | **Re-verificado**: sin `cron`/`triggers`/`scheduled` en ninguna configuración ni código |

No hay mala fe: cada documento describe la **intención** del incremento. Pero el efecto acumulado es que el proyecto **se cree más maduro de lo que es**, y esa creencia es lo que llevaría a un cutover catastrófico.

**Antídoto:** ninguna afirmación de garantía sin comando reproducible al lado — **y el comando hay que ejecutarlo**. Un grep negativo no es evidencia de ausencia; es evidencia de que el patrón no coincidió. Los hallazgos de este ciclo que sobreviven se re-verificaron con ejecución real (Postgres 16 local con las migraciones aplicadas) o con patrones amplios.

---

## AID-004 — Nombres distintos para el mismo concepto (P2)

Cada ciclo de generación introdujo su propio vocabulario y ninguno unificó los anteriores:

| Concepto | Nombres coexistentes | Dónde |
|---|---|---|
| **Tenant** | `company` · `organization` · `organizations` · `org` · `companyId` · `orgId` · `organization_id` | `tenant.ts` traduce con `TABLE_MAP = { company: "organizations" }` |
| **Identificador** | `_id` (Totalum) · `id` (Postgres) | `refId()` normaliza |
| **Comprador** | `customer` (cliente final) · `partner` (revendedor) · `user` (empleado) · `lead` | Correcto pero sin glosario |
| **Venta** | `order` (cabecera) · `booking` (línea) · `quote` · `access_ticket` | Un `booking` **es** una línea de pedido; el nombre no lo dice |
| **Vendedor** | `seller` (entidad comercial) · `user` con rol `seller` | Dos entidades, un nombre |

`booking` como *línea de pedido* es la ambigüedad más peligrosa: invita a un desarrollador nuevo a tratarla como agregado independiente y a saltarse `order`.

**Antídoto:** un `GLOSSARY.md` con el modelo canónico, y unificar `company` → `organization` durante la migración (ya hay que tocar ambos lados).

---

## AID-005 — Sistemas paralelos incompletos (P2)

Funcionalidades creadas en prompts distintos que resuelven variantes del mismo problema sin integrarse entre sí:

- **Emisión de derechos de acceso:** `voucher` (integrado con la venta) vs `access_ticket` vs `membership` vs `gift_card`. `VALIDATION.md` ya reconoce que los tres últimos son *"sistemas paralelos incompletos"* sin máquina de estados.
- **Estado de un recurso:** `attraction.status`, `asset.status` + `asset-impact.ts`, `departure.status` derivado, más un flujo de aprobaciones (`approvals.ts`). Cuatro formas de decir "esto está o no operativo".
- **Métricas:** `hub-stats.ts`, `/api/dashboard`, `/api/reports/*` y cálculo en cliente en varias páginas. `AUDIT_REPORT.md` ya señaló *"mucha lógica duplicada de métricas"*.

---

## AID-006 — Registro monolítico como sustituto de diseño (P2)

`src/lib/resources.ts` (1 018 líneas) define 77 recursos con sus campos escribibles, expansiones, roles y allowlists. Es una solución **razonable** — genera 154 endpoints REST consistentes y ha resistido la auditoría de seguridad. Pero:

- Cambiar la regla de escritura de una entidad implica editar un fichero de mil líneas que toca todo el ERP.
- La configuración no es verificable: nada comprueba que `writable` coincida con las columnas reales, ni que `search` apunte a campos indexados.
- Es el punto donde un error de una línea afecta a los 77 recursos.

**No recomiendo desmontarlo.** Recomiendo derivarlo del esquema y añadir tests de contrato por recurso.

---

## AID-007 — Configuración heredada de la plataforma generadora (P2)

Restos del andamiaje de Totalum que ya no sirven al producto y sí le hacen daño:

| Resto | Efecto |
|---|---|
| `package.json: "name": "nextjs-totalum-project"` y descripción de plantilla | El repositorio no se identifica como el producto |
| `README.md` describe la plantilla, no la aplicación | Un desarrollador nuevo empieza desorientado |
| `frame-ancestors *` + `X-Frame-Options` eliminado | Clickjacking (`SEC-004`) — existe para el editor visual |
| `Cache-Control: no-store` en `/:path*` | Anula todo cacheo, incluidos estáticos (`SCA-003`) |
| `scripts/totalum-source-tags.js` (webpack `enforce: "pre"`) | Inyecta `data-tlm-loc="fichero:línea"` en cada JSX; desactivado en el build de despliegue |
| `env.d.ts` de **288 241 bytes** generado por `wrangler types` y commiteado | Ruido en cada diff |
| `README`: *"Only push to develop"* | Contradice el flujo real de este repositorio (`main` + PRs) |

---

## AID-008 — 482 usos de `any` (P3)

`grep -E ':\s*any\b|as any\b' src/` → **482**. Con `tsconfig` en `strict: false`, el compilador pasa limpio pero la seguridad de tipos es parcial. La mayoría están en fronteras legítimas (respuestas del SDK de Totalum, que no está tipado, y encadenamiento de PostgREST). No son "errores ocultos" en el sentido clásico, pero **sí ocultan el coste real de `DB-011`**: sin tipos derivados del esquema, un cambio de columna no rompe la compilación.

**Antídoto (con la migración):** generar tipos desde Postgres (`supabase gen types`) y activar `strict: true` de forma incremental.

---

## La pregunta final (Fase 58)

> *Si mañana desaparecen todas las conversaciones que se usaron para construir esta aplicación, ¿podemos seguir desarrollándola?*

**Respuesta: SÍ, con dificultad — y es un resultado notablemente bueno.**

A favor: el código está estructurado en capas reales, los motores canónicos están comentados y testeados, `docs/` contiene 15 documentos de arquitectura y auditoría, el historial de Git es descriptivo, CI está definida y la suite pasa.

En contra, y es lo que hay que arreglar:
1. **La documentación afirma garantías falsas** (`AID-003`). Un desarrollador nuevo que confíe en ella hará un cutover que expone los datos de todos los tenants.
2. **El esquema de la base de datos en producción no está en el repositorio.** Es conocimiento que vive fuera del código, en el panel de un proveedor.
3. **Los comentarios explican bugs históricos, no invariantes de dominio.** `AUD-F34` no significa nada sin el informe.

> El conocimiento ya no vive en las conversaciones. Vive en `docs/` — pero parte de lo que `docs/` afirma no es cierto. **Corregir la documentación es tan urgente como corregir el código**, porque es lo que gobierna la siguiente decisión.
