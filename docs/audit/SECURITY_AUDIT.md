# SECURITY_AUDIT.md — Park & Tours

> Referencias: OWASP Top 10:2025, OWASP ASVS 5.0, NIST SSDF.
> Fecha: 2026-08-20 · Método: lectura de código + `npm audit` ejecutado + grep de secretos sobre árbol e historial de Git.
> **Auditoría independiente:** el autor de este informe no implementó las correcciones de PR #1/#2. Varias afirmaciones de esos PR se re-verificaron y **una resultó ser falsa** (`SEC-001`).

## Resumen

El **aislamiento entre empresas a nivel de aplicación es sólido** y las correcciones de RBAC de PR #1 **se sostienen** (re-verificadas: los 77 recursos tienen `writeRole`, el partner es deny-by-default en lista y detalle, `escapeRegex` está completo, los usuarios desactivados pierden acceso al instante). No hay secretos en el repositorio ni en el historial. No se encontró XSS explotable ni SQL injection.

Los problemas graves están en otro sitio: **la frontera de base de datos que la documentación da por hecha no existe**, la cabecera CSP invita al clickjacking, la librería de autenticación acumula avisos críticos que coinciden con esta configuración, y no hay forma de recuperar una cuenta.

| Severidad | Nº |
|---|---:|
| P0 | 3 |
| P1 | 6 |
| P2 | 5 |
| P3 | 2 |

---

## P0

### SEC-001 — RLS declarada en la documentación, nunca activada en el esquema
- **Área:** Aislamiento multi-tenant / control de acceso (OWASP A01)
- **Ficheros:** `supabase/migrations/0001_init_extensions_helpers.sql:52-77`, todas las migraciones `0004`–`0015`
- **Problema:** la función `app.enable_tenant_rls(tbl)` está definida y es correcta, pero **no se invoca sobre ninguna tabla de negocio**.
  ```
  $ grep -rhoiE "enable_tenant_rls\('[a-z_]+'" supabase/migrations/ | sort -u | wc -l
  0
  ```
  De 82 tablas con `organization_id`, sólo **5** tienen RLS activada (`organizations`, `organization_memberships`, `organization_relationships`, `plan`, `stripe_event`) más las políticas de `storage.objects`. Las **77 restantes** — `booking`, `payment`, `customer`, `commission`, `ledger_entry`, `receivable`, `cash_session`, `waiver`, `participant`… — quedan **sin RLS**.
- **Evidencia contradictoria:** `docs/migration/MIGRATION_PLAN.md:144` afirma *"RLS activa desde M1"*; `docs/architecture/ARCHITECTURE.md` y `PRODUCTION_READINESS_REPORT.md` listan *"Sí — RLS + app + UI"*. **Es falso.**
- **Cómo reproducir:** aplicar las migraciones en un Postgres limpio y ejecutar
  `select relname from pg_class where relrowsecurity = false and relname in (select table_name from information_schema.tables where table_schema='public');`
- **Explotación:** `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` viajan al navegador por definición. Supabase expone cada tabla de `public` por PostgREST con los privilegios por defecto de `anon`/`authenticated`. Sin RLS, cualquiera que abra la aplicación puede leer y escribir **todas las tablas de todos los tenants** con una petición HTTP directa, sin pasar por la aplicación.
- **Impacto de negocio:** pérdida total de aislamiento multi-tenant en el momento del cutover. PII de clientes, precios de coste, márgenes, deuda B2B y contabilidad de todas las empresas, expuestos.
- **Causa raíz:** el helper se escribió y se dio por aplicado; ningún test ni gate de CI verifica la cobertura de RLS.
- **Solución:** invocar `app.enable_tenant_rls('<tabla>')` en las 77 tablas (con `partner_scoped => true` donde exista `partner_id`), en una migración nueva. Añadir a CI una aserción que falle si alguna tabla con `organization_id` tiene `relrowsecurity = false`.
- **Riesgo de la migración:** bajo si se aplica **antes** de que haya datos; medio después (las rutas que hoy usan service-role seguirán funcionando, las que usan el cliente RLS empezarán a filtrar correctamente y hay que probarlas).
- **Validación requerida:** consulta de cobertura + test de integración que, con el JWT del tenant A, intente `select` sobre una fila del tenant B y obtenga 0 filas.
- **Estado actual:** **el riesgo NO está vivo en producción** porque `DATA_BACKEND` es `totalum` por defecto y Postgres no es aún la fuente de verdad. Es un **bloqueador absoluto del cutover**. Si ya existe un proyecto Supabase con datos reales, el riesgo es inmediato — **UNVERIFIED**: no se puede comprobar desde el repositorio.

### SEC-002 — RPC de capacidad ejecutable por `anon` y sin comprobación de tenant
- **Área:** Control de acceso / integridad (OWASP A01)
- **Ficheros:** `supabase/migrations/0001_init_extensions_helpers.sql:14-16`, `supabase/migrations/0008_capacity_txn.sql:20-95`
- **Problema:** dos defectos que se componen.
  1. `alter default privileges … grant execute on functions to authenticated, anon, service_role` concede ejecución de **todas** las funciones a `anon`.
  2. `reserve_departure_capacity` comprueba el tenant sólo si hay claim:
     ```sql
     if app.current_org_id() is not null and d.organization_id <> app.current_org_id() then
     ```
     Para `anon`, `app.current_org_id()` es `null` → **la comprobación se salta entera**.
  3. `release_departure_capacity` **no tiene comprobación de tenant en absoluto** y es `security definer`.
- **Explotación:** con la anon key pública y el UUID de una salida, un atacante no autenticado puede consumir el cupo de cualquier salida de cualquier tenant (`reserve`) o liberarlo (`release`), corrompiendo los contadores. El UUID v4 no es adivinable, pero se filtra a cualquiera que vea la salida — por ejemplo un usuario partner legítimo, que así ataca a otros tenants.
- **Impacto:** denegación de venta (cupo agotado artificialmente) o sobreventa forzada (liberación) en tenants ajenos.
- **Causa raíz:** `security definer` sin `revoke` explícito; la comprobación se escribió tolerante a `null` para permitir el modo service-role.
- **Solución:** `revoke execute … from anon, authenticated` sobre ambas funciones y exponerlas sólo a `service_role`; o exigir `app.current_org_id() is not null` (fallar cerrado) y añadir la comprobación de tenant a `release_departure_capacity`.
- **Validación:** test de integración llamando ambas RPC con la anon key → debe devolver `permission denied`.

### SEC-003 — `better-auth` 1.3.26 con avisos críticos que coinciden con esta configuración
- **Área:** Autenticación / dependencias (OWASP A06)
- **Fichero:** `package.json` (`better-auth: ^1.3.26`), `src/lib/auth.ts:97-104`
- **Problema:** `npm audit` clasifica `better-auth` como **critical**. Entre los avisos:
  - *"Two-Factor Authentication Bypass via Premature Session Caching (`session.cookieCache`)"* — **esta aplicación tiene `cookieCache: { enabled: true }`**.
  - *"Stale sessions persist after user deletion"* — contradice directamente la mitigación `AUD-S02`.
  - *"Rate limiter keys IPv6 addresses individually and is bypassable via prefix rotation"* — el rate limiting de login depende de este componente.
  - *"Double-Slash Path Normalization can Bypass disabledPaths Config and Rate Limits"*.
- **Impacto:** bypass de límites de intentos de login y persistencia de sesiones que deberían estar revocadas, en el sistema que protege todos los tenants.
- **Solución:** actualizar `better-auth` a la última versión parcheada y re-verificar `AUD-S02`. Si la migración a Supabase Auth avanza, esta dependencia desaparece — argumento adicional para la Opción A.
- **Validación:** `npm audit --production` sin críticos + test de que un usuario borrado/desactivado no puede operar.

---

## P1

### SEC-004 — CSP permite enmarcado desde cualquier origen (clickjacking)
- **Fichero:** `src/middleware.ts:62-66`
- **Problema:** `response.headers.set("Content-Security-Policy", "frame-ancestors *")` y `response.headers.delete("X-Frame-Options")`, aplicado a **todas** las respuestas, incluido el ERP autenticado.
- **Explotación:** un sitio malicioso embebe `/dashboard/pagos` en un iframe invisible y superpone su propia UI; el usuario autenticado ejecuta acciones financieras sin saberlo (clickjacking / UI redressing).
- **Causa raíz:** requisito de la plataforma de generación (previsualización dentro de un iframe) aplicado indiscriminadamente a producción.
- **Solución:** `frame-ancestors 'self' https://*.totalum-project.com` (o sólo `'self'` en producción). Además, no existe **ninguna otra directiva CSP** — sin `default-src`, `script-src` ni `object-src`, la cabecera no aporta defensa contra XSS.
- **Validación:** `curl -I` sobre una ruta de dashboard en producción.

### SEC-005 — CORS con credenciales hacia dominios comodín de terceros
- **Fichero:** `src/middleware.ts:19-30`
- **Problema:** en producción se refleja el `Origin` y se envía `Access-Control-Allow-Credentials: true` si el origen coincide con `^https://[^/]+\.(totalum-project|webapp-project)\.com$`. **En desarrollo se acepta cualquier origen** (`if (!isProduction) return true`).
- **Explotación:** cualquiera que controle un subdominio de esas plataformas compartidas (p. ej. otra app generada por el mismo proveedor) puede hacer peticiones autenticadas cross-origin contra esta API leyendo la respuesta. Junto con `SEC-004` da un vector CSRF/exfiltración completo.
- **Solución:** allowlist explícita de orígenes propios. `NEXT_PUBLIC_APP_URL` y los dominios personalizados del tenant, nada más.

### SEC-006 — Sin recuperación de contraseña ni verificación de email
- **Fichero:** `src/lib/auth.ts:46-92` (código escrito y **comentado**)
- **Problema:** `sendResetPassword` y `emailVerification` están comentados. Un usuario que olvida su contraseña **no puede recuperarla**; sólo un admin puede intervenir manualmente. Cualquiera puede registrarse con un email que no controla.
- **Impacto:** bloqueo permanente de cuentas (P1 operativo) y registro con identidad no verificada, que en un SaaS de pago habilita suplantación en el onboarding.
- **Solución:** activar ambos flujos con un proveedor de email real y crear `/forgot-password`, `/reset-password`, `/verify-email`.

### SEC-007 — Rate limiting inoperante en el runtime de producción
- **Fichero:** `src/lib/auth.ts:106-120` (el propio comentario del código lo admite)
- **Problema:** el store de `better-auth.rateLimit` es **en memoria**. Cloudflare Workers ejecuta isolates efímeros y distribuidos: cada uno tiene su propio contador. El límite de 5 intentos/min por IP no se aplica de forma global.
- **Impacto:** fuerza bruta y credential stuffing contra `/api/auth/sign-in/email`; creación masiva de tenants vía `/api/auth/sign-up/email` + `/api/setup` (que además puede sembrar cientos de registros con `seed_demo`).
- **Endpoints sin ningún límite:** `/api/checkin/lookup`, `/api/erp/*`, `/api/storage/upload`, `/api/stripe/webhook`.
- **Solución:** Cloudflare Rate Limiting binding (o Upstash Redis si se migra a Vercel) sobre `/api/auth/*`, `/api/checkin/*`, `/api/setup`, `/api/storage/upload`.

### SEC-008 — Cadena de dependencias con 3 críticas y 20 altas
- Ver `DEPENDENCY_AUDIT.md`. Destacan `next` (bypass de middleware en App Router — y el middleware es aquí frontera de sesión), `@opennextjs/cloudflare` (SSRF vía normalización de `/cdn-cgi/`) y `fast-xml-parser`.

### SEC-009 — Los fallos de auditoría se tragan
- **Fichero:** `src/lib/audit.ts:40-43`
- **Problema:** `writeAudit` envuelve todo en `try/catch` y ante un fallo sólo hace `console.error`. La operación de negocio continúa.
- **Impacto:** una impersonación de superadmin, un override de cupo o un reembolso pueden completarse **sin dejar rastro**, y nadie se entera. Para un sistema financiero multi-tenant, un audit trail que puede perder eventos en silencio no es un audit trail.
- **Solución:** para acciones de severidad `critical`/`warning`, el fallo de auditoría debe abortar la operación (o encolarla con reintento garantizado). Para `info`, alertar. Nunca fallar en silencio.
- **Nota adicional:** `audit_log` vive en la misma base que los datos que audita y es escribible por el SDK; no es inmutable. En Postgres debe ser `insert-only` (revocar `update`/`delete` incluso a `service_role` de aplicación).

### SEC-010 — `TOTALUM_API_KEY` con valor por defecto silencioso
- **Fichero:** `src/lib/totalum.ts:5`
- **Problema:** `process.env.TOTALUM_API_KEY || 'test-api-key'`. Una configuración ausente no falla al arrancar: la aplicación despliega y falla en tiempo de ejecución con errores de autorización opacos.
- **Solución:** fallar al arrancar si falta la variable (como sí hace `supabase/service.ts`, que es el patrón correcto).

---

## P2

| ID | Hallazgo | Fichero | Detalle |
|---|---|---|---|
| **SEC-011** | Mensajes de error internos al cliente | `src/lib/api-response.ts:15-22` | `serializeError` devuelve `message` y `e.response.data` del upstream. Filtra nombres de tabla/campo y mensajes del proveedor. Mapear a mensajes genéricos en producción; el detalle sólo al log. |
| **SEC-012** | `moduleEnabled` fail-open | `src/lib/tenant.ts` | Si `modules_enabled` está vacío devuelve `true`. Los límites de plan (`max_users`, `max_bookings_month`) **no se comprueban en ninguna parte** — grep vacío. Un tenant de plan básico usa todo. Impacto de negocio, no de seguridad. |
| **SEC-013** | Cookie de impersonación sin `secure` garantizado | `superadmin/impersonate/route.ts` | `secure` depende de que `NEXT_PUBLIC_APP_URL` empiece por `https://`. Si no está configurada, la cookie viaja sin flag. Usar `process.env.NODE_ENV === "production"`. |
| **SEC-014** | Idempotencia de Stripe check-then-act | `stripe/webhook/route.ts` | `alreadyProcessed` consulta y luego procesa, sin unicidad sobre `event_id`. Dos reintentos concurrentes de Stripe pueden procesarse ambos. Además **falla abierto** si la tabla no existe. Mitigado porque las escrituras son idempotentes por naturaleza (asignación de estado). |
| **SEC-015** | Subida de ficheros sin verificación de contenido | `storage/upload/route.ts`, `supabase/storage.ts` | `assertUploadable` valida `file.size` y `file.type`, y **`file.type` lo declara el cliente**. No hay verificación de magic bytes. La ruta sí se deriva en servidor (bien: no se puede escribir en otro tenant) y el bucket privado usa URL firmada de 600 s (bien). Validar magic bytes y forzar `Content-Disposition: attachment` en descargas. |

## P3

| ID | Hallazgo | Detalle |
|---|---|---|
| **SEC-016** | `allowedDevOrigins: ["*"]` en `next.config.ts` | Sólo afecta a `next dev`, pero es un patrón a evitar. |
| **SEC-017** | Bypass de matcher del middleware con `.` en la ruta | `pathname.includes(".")` salta la comprobación de sesión. Sin impacto real hoy porque los layouts re-verifican, pero es una regla frágil. |

---

## Controles verificados como CORRECTOS

| Control | Veredicto | Evidencia |
|---|---|---|
| Secretos en código o historial de Git | ✅ **Ninguno** | `git grep -E '(sk_live\|sk_test\|whsec_\|eyJhbGciOi\|-----BEGIN)'` limpio; `.env`, `.envProd`, `.env*.local` en `.gitignore`; `.env.example` sin valores |
| Escalada de privilegios en registro (AUD-001) | ✅ Cerrado | `role` no escribible; `/api/team` valida `ASSIGNABLE_ROLES` |
| IDOR en detalle ERP | ✅ Cerrado | `tenantFindOne` filtra por `company`; `assertPartnerCanRead` valida pertenencia |
| Aislamiento del portal B2B | ✅ Deny-by-default | `partnerScopeFor` → `denied` para toda tabla no listada |
| Autorización de escritura | ✅ Completa | **Los 77 recursos** tienen `writeRole`; partner es read-only en el ERP genérico |
| Mass assignment | ✅ Cerrado | `sanitizePayload` con allowlist `writable` + coerción numérica/fecha |
| Inyección de filtros por query string | ✅ Cerrado | `allowedFilterFields` restringe `filter.<campo>` |
| ReDoS en búsquedas | ✅ Cerrado | `escapeRegex` completo en `/api/erp` y `/api/checkin/lookup` |
| SQL injection | ✅ N/A | Sin SQL construido por concatenación; PostgREST parametriza |
| XSS | ✅ Sin hallazgos | Sin `dangerouslySetInnerHTML` en `src/` |
| Firma del webhook de Stripe | ✅ Obligatoria en producción | Rechaza si falta el secreto |
| Usuarios desactivados | ✅ Efecto inmediato | `getTenantContext` re-consulta y deniega si `status !== "active"` (pero ver `SEC-003`) |
| Códigos de voucher | ✅ CSPRNG | `src/lib/codes.ts`, 4 tests |
| Service role key fuera del bundle | ✅ Con gate en CI | `.github/workflows/ci.yml` |

## SSRF y CSRF

- **SSRF:** la aplicación no obtiene URLs proporcionadas por el usuario. `next.config.ts` limita `images.remotePatterns` a `placeholders.io`. **Sin superficie propia.** El riesgo llega por dependencias (`SEC-008`).
- **CSRF:** las cookies de better-auth son `SameSite=Lax`, lo que cubre el caso base. El riesgo real es indirecto vía `SEC-005` (CORS con credenciales) — corregir CORS cierra el vector.

## Modelo de amenazas (flujos sensibles)

| Activo | Actor hostil | Frontera de confianza | Amenaza | Mitigación hoy |
|---|---|---|---|---|
| Datos de otro tenant | Usuario autenticado de otro tenant | `tenant.ts` (aplicación) | Lectura/escritura cross-tenant | ✅ App · ❌ BD (`SEC-001`) |
| Datos de otro partner | Usuario `partner` | `partnerScopeFor` | Enumeración de reservas y comisiones | ✅ Deny-by-default |
| Dinero (pagos) | Usuario interno | `/api/payments` | Doble cobro, reembolso excesivo | ⚠️ Topes ✅ · idempotencia best-effort |
| Cupo | Cliente/vendedor | `assertCapacity` | Sobreventa | ⚠️ Mitigado |
| Cupo ajeno | No autenticado | RPC Postgres | Agotamiento/liberación | ❌ (`SEC-002`) |
| Sesión | Externo | `middleware` + layouts | Fuerza bruta, clickjacking | ❌ (`SEC-004`, `SEC-007`, `SEC-003`) |
| Rastro de auditoría | Interno | `writeAudit` | Acción sin registro | ❌ (`SEC-009`) |

## Privacidad

Clasificación en `PRODUCT_SPEC.md` §7. **No implementado:** política de retención, borrado de datos personales a petición, exportación, cifrado en reposo a nivel de campo para documentos de identidad. En `participant.document_id` y `waiver` hay PII sensible sin tratamiento diferenciado. Marcado **UNVERIFIED**: no consta la jurisdicción ni si aplica RGPD u otra normativa.
