# Preparación para producción

**Fecha:** 2026-09-22 · **Rama:** `claude/project-comprehensive-audit-uxp38i` (fusionada en `main`)

> Este documento sustituye al del 21 de agosto de 2026. Aquel decía «NO sin
> remediación» y era cierto entonces; catorce olas de trabajo después había
> dejado de serlo, y un informe desactualizado engaña en las dos direcciones —
> hace desconfiar de lo que ya está resuelto y tranquiliza sobre lo que no—.
>
> Todo lo que va marcado como comprobado se comprobó **ejecutándolo** en la
> fecha de arriba, no leyendo el código. Lo que no se pudo ejecutar va marcado
> como tal, y por qué.

---

## Veredicto

**Listo para operar tu propia empresa, con supervisión. Todavía no para
venderlo a terceros.**

La diferencia no es de matiz. El camino del dinero —vender, cobrar, cancelar,
devolver, liquidar al socio— tiene ahora pruebas, guardas que rompen la
compilación y catorce defectos reales corregidos y registrados. Lo que falta es
de otra clase: **los módulos fiscales no tienen red**, nadie ha visto el sistema
con carga real y la restauración de una copia nunca se ha probado.

Un fallo en lo primero te cuesta una reserva. Un fallo en lo segundo te cuesta
una declaración mal presentada o un proveedor cobrado dos veces.

---

## Lo comprobado hoy, ejecutándolo

| Qué | Cómo | Resultado |
| --- | --- | --- |
| Compilación de producción | `npx next build` | ✅ compila |
| Pruebas unitarias | `npm test` | ✅ **2 300** en verde |
| Tipos | `npx tsc --noEmit` | ✅ limpio |
| Lint | `npx next lint` | ✅ sin errores (1 aviso ajeno, preexistente) |
| Pruebas SQL contra Postgres real | `bash scripts/db-test.sh` | ✅ verde |
| RLS | recuento sobre las migraciones | ✅ **114 de 115 tablas**¹ |
| Secretos en el repositorio | `git ls-files` + búsqueda de patrones | ✅ ninguno² |
| Observabilidad | ficheros de configuración | ✅ Sentry instalado y conectado |

¹ La que falta es `app.rate_limit_bucket`: infraestructura del limitador, sin
datos de cliente. Las políticas cubren `select`, `insert`, `update` y `delete`,
no solo lectura.

² Solo `.env.example` está versionado. El JWT que aparece en `membego.test.ts`
es inventado y sin firma.

---

## Las puertas, revisadas una a una

Se mantienen los nombres del informe anterior para poder compararlos.

| Puerta | Antes (21-ago) | Hoy | Evidencia |
| --- | --- | --- | --- |
| **A** Especificación | PARCIAL | **PARCIAL** | Producto amplio y documentado; alcance sigue creciendo |
| **B** Compilación | PARCIAL | **PASA** | Build, lint, tipos y 2 300 pruebas en CI |
| **C** Base de datos | FALLA | **PARCIAL** | RLS completa y verificada; FKs sin inquilino siguen abiertas (ver DB-001) |
| **D** Seguridad | FALLA | **PASA** | Ver abajo: los cuatro P0/P1 de seguridad, cerrados y con guarda |
| **E** Lógica de negocio | FALLA | **PARCIAL** | Idempotencia cerrada; transacciones siguen sin existir (ver BL-002) |
| **F** Concurrencia | FALLA | **PARCIAL** | Retenciones, cupo y compensación probados; sin pruebas de carrera reales |
| **G** Pruebas | FALLA | **PARCIAL** | 2 300 unitarias y SQL contra Postgres; E2E casi inexistente (ver T-001) |
| **H** Fiabilidad | FALLA | **PARCIAL** | Reintentos y compensación sí; restauración sin probar (ver DR-001) |
| **I** Observabilidad | FALLA | **PARCIAL** | Sentry conectado y `job_run`/`system_incident` en uso; sin alertas verificadas |
| **J** Rendimiento | FALLA | **PARCIAL** | Panel medido con 120 000 reservas y corregido (800→450 ms); escritura medida (0,76→0,66 ms por reserva); sin pruebas de carga concurrente (ver P-001) |
| **K** Despliegue | PARCIAL | **PARCIAL** | CI en cada PR, `main` protegido; reversión sin probar |

---

## Los P0 y P1 del informe anterior

### Cerrados, y cómo se comprueba que siguen cerrados

| Ítem | Estado | Qué lo cierra |
| --- | --- | --- |
| **SEC-001** secretos locales | ✅ CERRADO | Solo `.env.example` versionado |
| **DB-002** RLS no cubría escrituras | ✅ CERRADO | `app.enable_tenant_rls` crea las cuatro políticas (`select`/`insert`/`update`/`delete`), todas con `organization_id = app.current_org_id()` |
| **BL-001** idempotencia | ✅ CERRADO | `sales_order.idempotency_key` único por empresa, más el uuid del revendedor en OCTO y la clave obligatoria en la API de socios — las tres con prueba |
| **Stripe checkout manipulable** | ✅ CERRADO | Exige `admin` y el `priceId` tiene que estar en la lista blanca del entorno: el importe no viaja en la petición |
| **CSRF** | ✅ CERRADO | `assertSameOriginMutation` en toda ruta mutante, con una guarda que recorre `src/app/api` y **falla la compilación** si aparece una sin él. Las excepciones van escritas con su motivo |
| **Subida de archivos sin autorización** | ✅ CERRADO | Exige sesión con permiso de escritura, rol `manager` para el bucket público, valida tipo y tamaño, y descuenta del límite del plan |
| **Cutover de Supabase / RLS incompleto** | ✅ CERRADO | 114/115 tablas; `assertSafeDataBackendConfig` **impide arrancar en producción** sin `SUPABASE_USE_RLS=true` |

Además, cerrados en este ciclo y no listados antes:

- **Treinta escrituras que se tragaban el error de la base** (AUD-M05/M07). Una
  de ellas dejaba retenciones de OTA que no caducaban nunca. Hoy hay guarda de
  código: ninguna escritura con la llave de servicio ignora su error.
- **El filtro por empresa en los servicios sin sesión** (AUD-M09). Se
  comprobaba solo, y los filtros se tapaban entre sí: ahora hay guarda que los
  exige de uno en uno.

### Abiertos, con su tamaño real

| Ítem | Riesgo | Qué es exactamente |
| --- | --- | --- |
| **DB-001** FKs sin inquilino | Medio | Ninguna clave foránea es compuesta `(organization_id, id)`. Con RLS activa, una sesión normal no puede apuntar a una fila de otra empresa; lo que queda expuesto es una escritura con la **llave de servicio** que referencie mal. La mitigación hoy es el filtro explícito en cada consulta, con guarda propia |
| **BL-002** sin transacciones | Medio | PostgREST no da transacciones multi-sentencia. La venta usa una saga con compensación (`compensateOrder`), probada. Lo que no se puede garantizar es atomicidad estricta: un fallo del proceso entre dos pasos deja un estado que la compensación repara *después* |
| **T-001** E2E casi inexistente | **Alto** | Dos ficheros de Playwright. Nada recorre vender→cobrar→cancelar en un navegador |
| **F-001** módulos fiscales sin pruebas | **Alto** | `invoice-service` (NCF), `dgii-service` (606/607) y `supplier-settlement-service` suman 1 090 líneas sin una sola prueba. Un NCF mal emitido no se corrige: se nota de crédito |
| **P-001** rendimiento desconocido | Medio | **Medido** (9.17). Con 120 000 reservas y 60 000 cobros de un inquilino: el panel a 365 días tardaba ~800 ms y a 30 días ~104 ms. `EXPLAIN` señaló `select b.*` materializando 150 MB y releyéndolos seis veces; 0096 lo corrige a ~450 y ~72 ms con la salida idéntica. La escritura también: 0,76 ms de disparadores por reserva, 0,66 tras 0097. Queda **abierto** lo que no se ha hecho: pruebas de carga con concurrencia, y el panel a 365 días sigue en ~450 ms —bajarlo más exige una pasada única con `grouping sets` o una tabla de instantáneas |
| **DR-001** restauración sin probar | **Alto** | Supabase hace copias; que se pueda volver de una no lo ha verificado nadie |
| ~~**CI-001** el E2E corre contra el proyecto de producción~~ | **CERRADA** | Cada corrida levanta **su propia pila de Supabase** (`supabase/config.toml`), aplica las migraciones desde cero y la destruye al terminar. El fichero del CI ya no contiene **ni una sola** referencia a `secrets.*`: no hay llave de servicio sobre la operación real que pueda usarse mal. De regalo, el E2E comprueba ahora que las migraciones levantan un sistema utilizable **desde cero**, que no lo comprobaba nadie. Ver AUD-M27 |

---

## Cobertura, medida

- **Servicios sin ninguna prueba: 20** (5 320 líneas). Por tamaño:
  `membego-redemption-service` (596), `membego-service` (550),
  `dispatch-service` (499), `supplier-settlement-service` (453),
  `attribution-service` (378), `public-booking-service` (357),
  `invoice-service` (351), `seller-goals-service` (348), `bundle-service` (340),
  `schedule-service` (293), `dgii-service` (286), `system-health-service` (257),
  `analytics-service` (221), `commission-adjust-service` (199),
  `plan-service` (191), `import-service` (189), `quote-service` (154),
  `manifest-service` (94), `cash-service` (93), `gift-card-service` (71).
- **Rutas de API: 152**, de las cuales 5 con prueba propia. El resto está
  cubierto **estructuralmente** por las guardas de `ui-contracts.test.ts`
  —CSRF, plan, inquilino, forma de la respuesta—, que es otra cosa que probar su
  lógica.
- **Pruebas SQL contra Postgres de verdad:** 10 ficheros.

---

## Lo que NO se ha podido comprobar desde aquí

El entorno donde se escribe esto **no tiene credenciales de Supabase**. Por lo
tanto, sobre la base real no se sabe:

- qué migraciones están aplicadas (en el repositorio hay **67**);
- si el hook del token (`app.custom_access_token_hook`) está instalado y activo;
- si las variables de entorno están puestas en el alojamiento;
- si las copias de seguridad corren, y con qué retención.

Para eso existen dos comprobadores en el repositorio, que hay que ejecutar **con
credenciales** desde un sitio que las tenga:

```bash
npm run verify:migrations     # qué falta aplicar
npm run validate:supabase     # RLS, exposición anónima, membresías, conteos
```

Ninguno de los dos imprime datos ni secretos: solo estados y recuentos.

---

## Antes de abrir a terceros

En orden de lo que más cuesta si sale mal:

1. **Probar una restauración.** Recuperar una copia en un proyecto aparte y
   comprobar que la operación arranca con ella. Sin esto, la copia es una
   suposición.
2. **Red sobre lo fiscal.** `invoice-service`, `dgii-service` y
   `supplier-settlement-service`. Es lo que te multa o le paga dos veces al
   transportista.
3. **E2E del camino del dinero.** Vender, cobrar, cancelar y reembolsar en un
   navegador, contra una base de prueba.
4. **`EXPLAIN` y carga** sobre las consultas del panel y del manifiesto, que
   son las que se abren cien veces al día.
5. ~~**Separar el proyecto de Supabase del CI** del de producción (CI-001).~~
   **HECHO**, y mejor que separándolo: el CI levanta su propia pila efímera, así
   que no hay un segundo proyecto que mantener ni ningún secreto que custodiar.
6. **Probar la reversión de un despliegue**, una vez, a propósito.

---

## Para operar tu empresa desde ya

Lo que hay que tener hecho antes de la primera venta real:

- [ ] `npm run verify:migrations` sin nada pendiente (la **0067** es la última).
- [ ] `SUPABASE_USE_RLS=true` en producción — si no, la aplicación **se niega a
      arrancar**, por diseño.
- [ ] `CRON_SECRET` puesto, y los cinco trabajos programados dados de alta
      (`vercel.json` los declara; el plan Hobby solo admite diarios).
- [ ] `NEXT_PUBLIC_APP_URL` correcto: de ahí salen los enlaces que reciben tus
      clientes (voucher, encuesta, portal).
- [ ] `STRIPE_WEBHOOK_SECRET` si cobras con Stripe.
- [ ] Un superadministrador creado (`npm run bootstrap:superadmin`).
- [ ] Una restauración probada. Aunque sea una vez.
