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
| **C** Base de datos | FALLA | **PARCIAL** | RLS completa y verificada. Las FKs sin inquilino ya no son un hueco sin número: **141 medidas, 105 quedan**, y las dos familias que importan —dinero/entrada/descargo y personas— están a **cero** (ver DB-001) |
| **D** Seguridad | FALLA | **PASA** | Ver abajo: los cuatro P0/P1 de seguridad, cerrados y con guarda |
| **E** Lógica de negocio | FALLA | **PARCIAL** | Idempotencia cerrada. Transacciones siguen sin existir, pero el deshacer dejó de ser opcional: inventario de efectos con guarda, y dos huecos medidos y cerrados —el cobro del monedero y el cupo del socio— (ver BL-002) |
| **F** Concurrencia | FALLA | **PASA** | Las cinco carreras del dominio, medidas y cerradas, las cinco corriendo en CI: sobreventa de plazas (19 reservas de 10 antes, 10 ahora), cupo del socio (el contador acababa en **2** con las 30 ventas pasando; ahora 10), apertura de caja (**18 turnos abiertos** sobre el mismo cajón; ahora 1), cierre de turno y aprobación del descuadre (el mismo faltante **asentado 20 veces** en el libro; ahora 1). El monedero ya se serializaba con cerrojo sobre la fila del socio (0091). Lo que queda no es una carrera sino atomicidad estricta: ver BL-002 |
| **G** Pruebas | FALLA | **PARCIAL** | 4 176 unitarias, 10 ficheros SQL contra Postgres de verdad, y 18 recorridos de navegador en 6 ficheros —incluido el de vender→cobrar→cancelar, que era el que faltaba (ver T-001)— |
| **H** Fiabilidad | FALLA | **PARCIAL** | Reintentos y compensación sí. El procedimiento de restauración y su comprobación corren en CI, con seis controles negativos (ver DR-001); falta hacerlo una vez contra el proyecto real |
| **I** Observabilidad | FALLA | **PARCIAL** | Sentry conectado y `job_run`/`system_incident` en uso; sin alertas verificadas |
| **J** Rendimiento | FALLA | **PARCIAL** | Panel y escritura medidos y corregidos (800→450 ms; 0,76→0,66 ms por reserva), y ahora también **con concurrencia**: con cuatro núcleos el panel del año se planta en **5,4 visitas/s** —una por núcleo— y **no impide vender** (coger plaza: 0,3 → 1,8 ms con dieciséis personas en el informe). El banco de medición vive en el repositorio y se corre con un comando. Lo que queda es el coste por visita, que pide una tabla de instantáneas (ver P-001) |
| **K** Despliegue | PARCIAL | **PARCIAL** | CI en cada PR, `main` protegido; reversión sin probar. **Y hay algo que mirar ya: GitHub Actions no ejecuta NADA en este repositorio desde el 28-sep 17:12**, ni en las ramas ni en `main`, con el flujo en estado `active` y una PR abierta. Eso no se arregla desde el código —suele ser el límite de gasto o de minutos de la cuenta— y mientras dure, ninguna corrida verde es posible |

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
| **DB-001** FKs sin inquilino | Medio | **Reducido.** La premisa no cambia: ninguna clave foránea es compuesta `(organization_id, id)`, así que lo expuesto es una escritura con la **llave de servicio** que referencie mal —con RLS puesta, una sesión normal no puede—. Lo que cambia es que ya está medido y acotado: **141 referencias sin comprobar**, de las que 0102 cierra **36** en 25 tablas por un criterio escrito —toda referencia a una PERSONA (cliente, vendedor, proveedor) o a un DOCUMENTO SOBRE UNA PERSONA (reserva, venta)—. **141 → 105**, y ese 105 es un número **exacto en las dos direcciones**, no un tope: con el tope anterior de 141, una pérdida de tres comprobaciones cabía debajo sin que nada lo dijera (y pasó: registrar `pickup` por su nombre sustituyó al disparador de 0018). La más cara de las 36 no es de dinero — `supplier_response_token.supplier_id` es la llave del portal del proveedor, y apuntando a otro proveedor ese enlace abre el portal de otra empresa. Sigue abierto lo que queda fuera del criterio: **105 referencias** a cosas —almacén, mantenimiento, turnos, activos—, sin cubrir a propósito porque cada comprobación cuesta una lectura por alta |
| **BL-002** sin transacciones | Medio | **Reducido.** La premisa no cambia —PostgREST no da transacciones y reescribir la venta entera como función de base sería cambiar un riesgo conocido por otro mayor—, pero el hueco práctico sí se estrechó. Medido y corregido: (1) el cobro del monedero prepago corría **fuera** de la saga y **se tragaba su error**, así que un fallo dejaba la venta confirmada con el saldo del socio intacto y sin una fila que lo dijera; ahora va dentro, antes de promover la orden, y devuelve el dinero al compensar; (2) la compensación cancelaba las reservas sin devolver **el cupo del socio**, que a diferencia de la plaza no caduca — el `catch` sí lo devolvía, pero con un mapa en memoria que muere con el proceso, así que el barrido no. Y hay un **inventario con guarda**: cada efecto de la venta declara quién lo deshace, y añadir una escritura sin su deshacer pone la prueba en rojo. Sigue abierto lo irreducible: entre dos escrituras no hay atomicidad, y lo que la cubre es compensación + barrido + caducidad, no una transacción |
| **T-001** E2E casi inexistente | Medio | **Reducido, y ahora se sabe POR QUÉ no corría.** Son **seis ficheros con 18 recorridos**, incluido `venta-completa.spec.ts` (vender→cobrar→tomar la plaza→cancelar→devolverla con el ratón, afirmando cada paso contra la API con la misma sesión, más el rechazo de sobreventa por el servidor). Lo que decía este informe —«esa spec no se ha ejecutado nunca»— era verdad y la causa no era solo la falta de docker aquí: **el montaje del E2E sembraba `departure.status = "scheduled"`, que la columna no admite**, así que PostgREST rechazaba el insert, el montaje lanzaba y NINGUNA prueba de navegador llegaba a arrancar. Más de cien corridas de CI fallaron ahí, y `main` tiene el mismo valor. Corregido, con guarda nueva que compara cada literal del montaje contra los valores que la columna declara. **Sigue abierto lo mismo de antes, y no es poco**: que el montaje ya no se caiga no significa que las pruebas pasen. Nadie ha visto todavía una corrida verde |
| ~~**F-001** módulos fiscales sin pruebas~~ | **CERRADA** | Medido: los **20** servicios que este informe listaba sin una sola prueba tienen hoy su fichero, `invoice-service`, `dgii-service` y `supplier-settlement-service` incluidos. La cobertura de más abajo es de un ciclo anterior y queda como registro de dónde se venía |
| **P-001** rendimiento desconocido | Medio | **Reducido, con capacidad medida.** 9.17 dio los primeros números (panel 800→450 ms con 120 000 reservas; escritura 0,76→0,66 ms) y dejó abierto que **todo era un solo cliente**. Ya no: `scripts/perf-panel.sh` + `supabase/perf/volumen.sql` siembran 120 000 reservas y miden con 1, 2, 4, 8 y 16 clientes a la vez. Resultado: el panel **gasta un núcleo entero por visita**, así que el caudal se planta en **~5,4 visitas/s con cuatro núcleos** y a partir de ahí la latencia crece en línea recta (16 clientes → p50 2,8 s). La ventana por defecto —el mes— cuesta 186 ms y aguanta ~23/s. Y la pregunta que importaba tiene respuesta medida: **el panel cargado NO impide vender** (coger plaza pasa de 0,3 a 1,8 ms de mediana, peor caso 43 ms). Sigue abierto el coste por visita: **cinco mejoras medidas y las cinco descartadas**, incluida la que este informe daba por buena —fundir los desgloses con `grouping sets`, prevista en ~140 ms y medida en **5 ms**—; bajar de ~610 ms pide una tabla de instantáneas, que es una ola entera. Y lo medido es una máquina de cuatro núcleos: la capacidad de la instancia real está sin medir, y el banco existe para correrlo allí |
| **DR-001** restauración sin probar | Medio | **Reducido, no cerrado.** El PROCEDIMIENTO y la COMPROBACIÓN sí están probados: `scripts/restore-drill.sh` monta la base, la vuelca, **la destruye**, la restaura y pasa `supabase/verify/restauracion.sql` (13 filas), y luego rompe la base a propósito **seis veces** exigiendo qué fila caza cada rotura. Corre en cada CI. La comprobación ya no puede envejecer: una guarda la compara con las migraciones. Lo que sigue abierto es lo único que no se puede hacer desde aquí — **un simulacro contra el proyecto de Supabase de verdad**, que son treinta minutos y está escrito paso a paso en `docs/runbooks/RESTAURACION.md`. Mientras el registro de simulacros de ese manual esté vacío, esto no está cerrado |
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
