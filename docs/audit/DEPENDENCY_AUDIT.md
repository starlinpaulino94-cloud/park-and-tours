# DEPENDENCY_AUDIT.md — Park & Tours

> Fecha: 2026-08-20 · `npm ci` (exit 0) + `npm audit` ejecutados en este entorno.
> Complementa `docs/architecture/DEPENDENCY_AUDIT.md` (PR #2, orientado a la migración). Este documento se centra en **supply chain y riesgo de seguridad**.

## Resultado de `npm audit`

```
critical   3
high      20
moderate  33
low        4
──────────────
total     60
```

**CI no ejecuta `npm audit`.** El pipeline pasa en verde con 3 vulnerabilidades críticas presentes.

## Críticas

### 1. `better-auth` — **es la librería de autenticación en producción**

Avisos que **coinciden con esta configuración concreta**:

| Aviso | Relevancia aquí |
|---|---|
| Bypass de 2FA por *premature session caching* (`session.cookieCache`) | `src/lib/auth.ts:100-103` tiene **`cookieCache: { enabled: true }`** |
| Sesiones obsoletas persisten tras borrar el usuario | Contradice la mitigación `AUD-S02` |
| Rate limiter indexa IPv6 individualmente → bypass por rotación de prefijo | El límite de login depende de este componente |
| Normalización de doble barra evita `disabledPaths` y rate limits | Bypass adicional del mismo control |
| Toma de cuenta por auto-vinculación OAuth con email no verificado | No aplica hoy (OAuth desactivado), aplica si se activa |

**Acción:** actualizar a la versión parcheada más reciente y re-verificar `AUD-S02` con un test. Si se completa la migración a Supabase Auth, esta dependencia **desaparece** — argumento adicional para la Opción A.

### 2. `fast-xml-parser` — transitiva vía `@aws-sdk/*` ← `@opennextjs/aws` ← `@opennextjs/cloudflare`
Bypass de codificación de entidades y expansión de entidades DOCTYPE (billion laughs). Llega por la cadena de despliegue, no por código de la aplicación. Riesgo **indirecto**, pero está en el árbol de producción.

### 3. `vitest` — sólo desarrollo
Lectura y ejecución de ficheros arbitrarios cuando el servidor de UI de Vitest escucha. **No se usa `--ui`.** Riesgo real bajo; actualizar de todos modos.

## Altas relevantes

| Paquete | Aviso | Por qué importa **aquí** |
|---|---|---|
| **`next` 15.3.9** | *Middleware / Proxy bypass en App Router vía rutas segment-prefetch* (y su incomplete-fix follow-up), cache poisoning de RSC, XSS con nonces CSP, varios SSRF y DoS | **`src/middleware.ts` es la frontera de sesión de las páginas.** Mitigado en parte porque los layouts re-verifican en servidor — pero es exactamente el tipo de defensa en profundidad que no debe ser la única |
| **`@opennextjs/cloudflare` 1.3.0** | *SSRF vía bypass de normalización de `/cdn-cgi/`* | Es el adaptador de despliegue en producción |
| `undici` | Smuggling de petición/respuesta, inyección CRLF, consumo ilimitado de memoria | Runtime de `fetch` |
| `sharp` / `miniflare` / `ws` / `wrangler` | Varios (libvips, inyección de comandos en `wrangler pages deploy`) | Cadena de build y despliegue |
| `postcss`, `minimatch`, `picomatch`, `brace-expansion`, `js-yaml`, `glob`, `flatted`, `nanoid`, `defu` | ReDoS, prototype pollution, path traversal | Transitivas de build |
| `kysely` | SQL injection con `Kysely<any>` | Transitiva; **no se usa directamente** |

## Riesgo de dependencia crítico: Totalum

| | |
|---|---|
| **Servicio** | Totalum (`totalum-api-sdk` 3.0.8) |
| **Propósito** | **Es la base de datos.** También el auth store vía adapter propio |
| **Criticidad** | **P0 — punto único de fallo absoluto.** Si Totalum cae, no hay aplicación: ni login, ni check-in, ni venta |
| **Datos almacenados** | Todo: PII de clientes y participantes, finanzas, contabilidad, auditoría |
| **Fallback** | **Ninguno.** Sin cache, sin modo lectura, sin degradación |
| **Timeout / circuit breaker** | **Ninguno** (`BIZ-005`) |
| **Lock-in** | **Total.** El esquema vive en el panel del proveedor, no en el repositorio |
| **Dificultad de migración** | Alta — ya en curso (M1–M5), ETL escrito y testeado, cutover pendiente |
| **SLA / backups** | **Desconocidos.** No documentados, no verificables por el equipo |
| **Modelo de precios** | **No consta en el repositorio.** Con ~57 llamadas por venta, es un riesgo de coste no modelado (`SCALABILITY_AUDIT.md`) |

> *¿Qué ocurre si mañana desaparece este proveedor?* **El producto desaparece con él, y no sabemos si podríamos recuperar los datos.** Ésta es la razón de fondo por la que la Opción A (migrar) es la recomendación, más allá de cualquier defecto técnico concreto.

## Resto de dependencias externas

| Servicio | Propósito | Criticidad | Fallback | Lock-in |
|---|---|---|---|---|
| **Stripe** | Suscripción SaaS del tenant | P0 (ingresos) — P2 (operación: un fallo no impide operar) | Ninguno | Medio — estándar del sector |
| **Supabase** | Destino: DB + Auth + Storage | P0 futuro | Ninguno | **Bajo** — es Postgres estándar, migrable a cualquier proveedor |
| **Cloudflare Workers** | Hosting vía OpenNext | P0 | Ninguno | Medio — OpenNext acopla al adaptador |

## Lockfile y reproducibilidad

| Ítem | Estado |
|---|---|
| Lockfile presente y versionado | ✅ `package-lock.json` (v3, 806 KB) |
| Un solo gestor de paquetes | ✅ npm |
| `npm ci` reproducible | ✅ exit 0 en este entorno |
| Versiones fijadas | ⚠️ Mixto: `next`, `react`, `wrangler`, `@opennextjs/cloudflare` fijados; el resto con `^` |
| Avisos de deprecación en la instalación | ✅ **0** |

## Dependencias cuestionables

| Paquete | Observación |
|---|---|
| `postcss` en `dependencies` | Es herramienta de build; debería estar en `devDependencies` |
| `ts-node` | Sólo lo usa `scripts/setup-stripe-webhook.ts` — mover a `devDependencies` |
| 24 paquetes `@radix-ui/*` | Normal en shadcn/ui, pero conviene verificar cuáles se usan de verdad |
| `totalum-api-sdk` | Se elimina al completar la migración |
| `better-auth` + adapter propio (592 líneas) | Se elimina al completar la migración |

## Acciones

**Inmediatas (bloqueantes para producción)**
1. Actualizar `better-auth` a la versión parcheada. Re-verificar `AUD-S02` con test.
2. Actualizar `next` a la última 15.x parcheada.
3. Actualizar `@opennextjs/cloudflare` (arrastra `@aws-sdk`/`fast-xml-parser`).
4. **Añadir `npm audit --audit-level=high` a CI** como paso bloqueante.

**Corto plazo**
5. Activar Dependabot (o Renovate) con agrupación de actualizaciones de seguridad.
6. Mover `postcss` y `ts-node` a `devDependencies`.
7. Ejecutar OpenSSF Scorecard sobre el repositorio.

**Estratégica**
8. Completar la migración: retira `totalum-api-sdk` y `better-auth` — las dos dependencias de mayor riesgo del proyecto, de golpe.
