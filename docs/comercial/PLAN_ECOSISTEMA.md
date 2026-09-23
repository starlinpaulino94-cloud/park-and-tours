# Plan del ecosistema — vendedores, tour centers, socios y transportistas

> **Qué es esto.** El encargo fue: «el vendedor debe tener su propio apartado
> donde ve sus movimientos; igual los tour centers y las empresas asociadas; el
> sistema no debe servir solo para una empresa sino para todas las asociadas, y
> también para los transportistas». Esto es la revisión de qué ofrece hoy el
> sistema, qué da por hecho el mercado, y el plan para cerrar la diferencia.
>
> **Prioridad declarada por la dirección: el apartado del vendedor va primero.**
>
> Todo dato de este documento está verificado contra el repositorio en la fecha
> de su última edición. Donde no pude verificar algo, lo digo.

---

## 1. Dónde estamos

El sistema es hoy un **ERP interno completo y bien construido** —venta,
reservas, salidas, despacho, caja, comisiones, liquidaciones, fiscalidad
dominicana con NCF— con **un solo actor externo medio abierto**: el socio B2B.

Lo que todavía no es: un ecosistema. De los cuatro actores del encargo, **tres
no tienen sitio propio donde entrar, ver lo suyo y trabajar**.

### El vendedor

Ya tiene lo caro: **el ámbito por fila existe y está desplegado**
(`src/lib/seller-scope.ts`, aplicado en `buildListFilter`, en el detalle por
identificador, en `/api/orders`, en `/api/quotes` y en el informe de cobros).
El contexto resuelve `ctx.sellerId` desde `seller.user_id` en cada petición, la
ficha deja vincular la cuenta, y hay 21 pruebas unitarias más 4 contratos que
leen las rutas.

Lo que le falta, **verificado**:

| Hueco | Evidencia |
|---|---|
| **No tiene apartado propio** | No existe ninguna carpeta `mi-espacio` bajo `src/app/dashboard`; el rol `seller` aterriza en el ERP con el menú recortado. `/api/me` devuelve `role` y `partnerId`, nunca `sellerId`. |
| **Su dinero es inalcanzable** | `READ_ROLE` reserva `commission`, `settlement`, `payable` y `booking_cost` a `manager`, y esa compuerta **se evalúa antes** del ámbito por fila. La única exención es `if (ctx.role !== "partner")`. Resultado: 403 en sus propias comisiones aunque el filtro ya esté escrito. |
| **La venta no se le sella** | `POST /api/orders` fuerza `partner_id` para el rol socio pero **no** fuerza `seller_id`. `/api/pos/context` devuelve hasta 200 vendedores y el desplegable deja elegir a cualquiera: un vendedor puede regalar su venta o quedarse la de otro. |
| **Cancela la reserva de otro** | `/api/bookings/[id]/cancel` exige rango `seller` y **no mira de quién es la reserva**. Cancelar anula comisión: es una fuga de escritura con impacto económico. Lo mismo `reschedule`. |
| **Lee el calendario de cobros de toda la empresa** | `READ_ROLE.payment_schedule = "seller"` y esa tabla **no tiene columna de vendedor** (su vendedor está en la orden, tabla unida). El informe de cobros sí se acota; `/api/erp/payment_schedule` no. |
| **Ve el costo del catálogo** | `product` no tiene `READ_ROLE`, así que `base_cost` viaja en la respuesta. |
| **Ve las condiciones de sus compañeros** | El directorio de vendedores es compartido a propósito; lo que sobra ahí son dos columnas, `commission_pct` y `monthly_goal`. |
| **No ve su enlace ni su QR** | El motor de atribución está completo y funcionando —`/e/[slug]`, cookies, `seller_link`, embudo— pero `GET /api/attribution` y la ruta del QR exigen `manager`. |
| **`max_discount_pct` no se aplica** | El campo existe y es escribible; ningún cálculo lo usa. |
| **Residuo consciente** | La regla es «lo mío, o lo de nadie». Las ventas sin vendedor las ven todos. Solo se puede cerrar cuando la venta se selle. |

### El tour center / empresa asociada

Existe un portal B2B (`/portal`) bien aislado, de solo lectura. **Pero hoy
ningún tour center puede entrar**: `src/app/api/team/route.ts` y
`invite/route.ts` **no contienen la palabra `partner_id` en ninguna línea**. El
formulario la pide y la envía; la API la descarta y crea la membresía sobre la
operadora. Como el identificador de socio solo se emite si la organización de la
membresía es de tipo `partner`, ese usuario llega al portal sin socio y recibe
403.

**Y hay una puerta trasera.** El aislamiento depende del **nombre del rol**
(`ctx.role === "partner"` en el layout y en el armador de filtros), no de la
organización — mientras que el identificador de socio se rellena para cualquier
rol. El día que se arregle el alta sin arreglar esto, un empleado de un tour
center dado de alta como `seller` o `cashier` entra al ERP interno de la
operadora. Hoy es **latente** precisamente porque el alta está rota.

**El catálogo autorizado no existe.** `authorized_products` se lee en
`/api/portal/catalog`, pero **no está en `partner.writable` ni en ningún
formulario**: nada en el sistema puede escribirlo. Y el código hace
`authorizedIds.length ? filtrar : {}` — lista vacía significa catálogo entero.
Es decir: **todo socio ve todo el catálogo, siempre**, y no hay forma de
cambiarlo.

### El transportista y los demás proveedores

No existen como identidad. `organizations.kind` admite `tenant`, `partner` y
`branch`; la tabla `supplier` no tiene usuario asociado. La operadora los
administra de punta a punta y ellos no ven, confirman ni reciben nada. El
manifiesto y la hoja de ruta son papel interno.

### Dos observaciones transversales, medidas

- **De 129 páginas del panel, 5 miran el rol en servidor** (`mi-dia`,
  `aprobaciones`, `exportar`, `reportes`, `perfil`), y ninguna de ellas es de
  las que enseñan dinero. La única guarda real en el layout es la redirección
  del rol socio. **El menú esconde; la URL no.**
- **La seguridad a nivel de fila SÍ está activa en producción.**
  `assertSafeDataBackendConfig` lanza `Unsafe production config` si
  `NODE_ENV === "production"` y `SUPABASE_USE_RLS !== "true"`: en producción, o
  está activa, o la aplicación no arranca. **Consecuencia que invierte una
  conclusión cómoda: cada tabla que se abra a un actor nuevo necesita su
  política en la misma fase, o la pantalla nueva devolverá vacío.**

---

## 2. Lo que el mercado da por hecho

Revisados: Checkfront, Ventrata, Bókun, Xola, TrekkSoft, Rezdy, FareHarbor,
Viator, Tourplan, Lemax, Moonstride, GetYourGuide, Welcome Pickups, Mozio,
Sengerio. Y la referencia local: Colonial Tour and Travel opera desde hace años
un portal B2B («TOzone») donde las agencias ven netos confidenciales y reservan.

### Vendedor a comisión (representante de hotel, vendedor de calle, conserje)

**Universal en todos los productos revisados:** login propio y aislado que
enseña solo sus reservas, sus clientes y su dinero, sin acceso al inventario ni
a los informes de la empresa · catálogo con su precio y disponibilidad en vivo ·
historial de sus ventas con estado · **comisión separada en devengada,
pendiente y pagada, y ligada a la fecha del tour, no a la de venta** (TrekkSoft
calcula sobre la salida; Rezdy libera el pago 14 días después del servicio;
Viator paga el mes siguiente al viaje).

**Común:** enlace y código QR propios por vendedor, con atribución automática
(Rezdy con cookie de 6 meses; FareHarbor en sesión) · **modos de cobro
flexibles** —el cliente paga al operador, el vendedor cobra todo y debe el neto,
o **el vendedor retiene solo su comisión como depósito** y el cliente paga el
resto al subir (FareHarbor: Referral / Billing / Net rate; Ventrata: «Collect my
commission as a deposit») · cierre de turno con desglose por medio de pago ·
resumen periódico por correo (Bókun manda ventas y comisión debida los lunes).

**Nicho:** metas visibles al propio vendedor. **El ranking entre compañeros no
aparece en ninguna plataforma de tours revisada.**

Y no es teoría local: se publican decenas de vacantes de «representante de
ventas Punta Cana» al mes, con modelos de 100 % comisión o base baja más 50-70 %,
y las operadoras locales (Cocotours, Punta Cana Adventures, Tours DR) ya
reclutan personal de hotel como fuerza de venta a comisión. **El vendedor se va
donde le enseñan su número.**

### Tour center / empresa asociada

**Universal:** reservar con disponibilidad en vivo solo los productos
habilitados, con su neto o su comisión según contrato · catálogo autorizado por
socio · **cuenta corriente bidireccional** —lo que debe y lo que le deben— con
estado de cuenta y facturas visibles.

**Común:** **usuarios múltiples por empresa, gestionados por el propio socio**,
con permisos propios (Tourplan sub-logins, Xola Parent/Child Agent, FareHarbor
roles dentro del afiliado) · reparto de la comisión por persona aunque la
factura se pague en bloque · control de crédito **y saldo prepago con recargas**
(Ventrata top-ups) · **marca del socio** en portal, vouchers y documentos ·
**API y tarifario neto descargable** para el socio que integra (Rezdy Agent API,
Lemax B2B API) · auditoría por socio: último acceso, segundo factor, registro de
eventos · alta con invitación y aceptación de condiciones.

### Transportista y proveedores

**Universal:** lista de servicios asignados, próximos y pasados, con los datos
operativos · **confirmar o rechazar con su propio número de confirmación**, con
plazo declarado (GetYourGuide: 24 h) · asignar su propio chofer y vehículo, y
que el cliente reciba placa y teléfono · manifiesto y hoja de ruta entregados ·
**app móvil de estados en campo** —en camino, llegué, recogido, no-show— con
hora y posición, que es lo que después sirve de prueba en una reclamación ·
liquidación y estado de cuenta propios.

**Común:** documentación de flota y conductores con vencimientos y **bloqueo de
asignación** (Sengerio avisa a 30 días y bloquea vehículos con seguro vencido).

En el mercado local esto es además el argumento comercial: la diferencia entre
la operadora formal y el vendedor de playa es el permiso de MITUR, el RNC, el
seguro y **el comprobante formal con hora y punto de recogida**. La queja que
mata la venta es «pagaron y nunca los recogieron».

---

## 3. El plan por fases

Cada fase se entrega completa y desplegable. Se puede parar después de
cualquiera con algo que funciona. **Las semanas son semanas-persona de
desarrollo puro**: no incluyen regresión, formación ni soporte del cambio.
Ajustar al equipo real.

> **Numeración de migraciones.** La última aplicada es `0069_seller_account_link`.
> La siguiente libre es **0070**.

---

### Fase 1 — El vendedor es dueño de su venta y tiene dónde verla · 3 semanas

**Objetivo.** Que la venta que hace un vendedor se le selle a él, que no pueda
tocar la de otro, y que aterrice en un apartado propio.

1. **Sellado de la venta.** `POST /api/orders` fuerza `seller_id = ctx.sellerId`
   cuando quien llama es vendedor —mismo patrón que el forzado de `partner_id`
   que ya existe—; `createOrderWithBookings` ignora el `seller_id` del cuerpo
   para ese rango; `seller` y `partner` dejan de ser escribibles por rango
   `seller` en `order` y `lead`; `/api/pos/context` devuelve solo su ficha.
   **Gerencia conserva la libertad de vender en nombre de otro**: la restricción
   es por rango, no absoluta.
2. **`assertSellerCanWrite`, simétrico al `assertSellerCanRead` que ya existe.**
   El ámbito de hoy es de lectura, más la guarda del `PUT` genérico. Quedan
   abiertas las acciones con impacto económico sobre reserva ajena: `cancel`,
   `reschedule`, cambio de pax, de recogida, cobro, reembolso, check-in,
   conversión de cotización. Se cierran **todas**, no dos.
3. **Inventario de rutas que arman su propio filtro.** `/api/orders` y
   `/api/quotes` ya se cerraron a mano *precisamente porque no pasan por
   `buildListFilter`*. Falta auditar las demás una por una: POS, métricas del
   panel, informes, check-in, cobros, despacho. **Cada una es una fuga idéntica
   a la que se dio por cerrada.** Entregable: la lista completa, cada ruta con
   su veredicto, y una prueba por ruta acotada.
4. **`src/lib/field-projection.ts`: recorte de columnas en un solo punto**,
   aplicado en listado, detalle **y exportación** —los tres, y el test debe
   fallar si uno queda sin migrar—. `product` pierde `base_cost` para rango
   vendedor (**proyectar, no bloquear**: aplicarle `READ_ROLE` a `product`
   dejaría al vendedor sin catálogo y rompería el punto de venta) y `seller`
   pierde `commission_pct` y `monthly_goal` de terceros.
5. **`payment_schedule` sube a `manager`** en `READ_ROLE`, o se le desnormaliza
   el vendedor de la orden. Hoy un vendedor lee el calendario de cobros de toda
   la empresa.
6. **Permiso de escritura por campo** (`src/lib/field-write-role.ts`).
   `seller.user` es la llave que decide de quién son las ventas y a quién se le
   paga, y hoy la escribe cualquier `manager` desde el CRUD genérico. Sube a
   `admin`, se valida contra una membresía activa de la misma organización y
   queda en la bitácora. **Subir todo el recurso a `admin` rompería el alta de
   vendedores por gerencia**: por eso hace falta la máquina por campo.
7. **Alta en un paso**: botón «Crear cuenta e invitar» en `/dashboard/vendedores`
   y ruta `POST /api/sellers/invite` que reutiliza `/api/team` y escribe
   `seller.user_id` en la misma operación. Al invitar con rol `seller` desde
   Equipo, crear o enlazar su ficha.
8. **Migración de datos, con decisión escrita.** Backfill de `seller.user_id`
   para los vendedores existentes (emparejado por correo, **propuesto y
   confirmado a mano, nunca automático**: el correo no es identidad) y
   resolución de fichas duplicadas. **Y la decisión que cuesta dinero: qué pasa
   con las comisiones ya devengadas cuando el sellado cambie la atribución.**
   Ver §6.
9. **`sellerId` en `/api/me`**, resuelto también por encima del rango vendedor,
   para que un gerente con ficha tenga su vista propia sin perder el ERP.
   Decidir además qué `sellerId` rige durante una **impersonación de
   superadmin**, ya que el aterrizaje se decide por ese dato y no por el rol.
10. **`/dashboard/mi-espacio` v1** con guarda de servidor en el layout: Resumen
    (ventas del mes, comisión devengada, meta) y Mis ventas; navegación
    reducida; aterrizaje tras el login; pantalla explícita «tu cuenta no está
    vinculada» para el vendedor sin ficha.
11. **Guardas de rol en servidor** en las pantallas que enseñan dinero:
    vendedores, metas, bonos, comisiones, liquidaciones, partners, personal,
    costos del catálogo. Hoy: **5 de 129 páginas** miran el rol, ninguna de
    estas.
12. **Pruebas de ruta y e2e.** Las 21 unitarias del ámbito ya existen; lo que
    **no** existe es cobertura de ruta (`/api/erp`, `/api/erp/[id]`,
    `/api/export`) ni e2e con sesión real de vendedor. Más semilla de
    demostración con vendedor vinculado (ya hecha en el sembrador).

**Criterio de hecho.** Un vendedor de la demo entra y aterriza en Mi espacio con
cifras distintas de cero; crea una venta sin poder elegir vendedor y la orden
nace con su identificador aunque el cuerpo traiga otro; `GET /api/erp/order`,
`/booking`, `/lead` y `GET /api/export/booking` devuelven solo filas suyas,
comprobado contra el total de la empresa; `/api/erp/product` no incluye
`base_cost`; `/api/erp/seller` no incluye `commission_pct` ajeno;
`/api/erp/payment_schedule` devuelve 403; teclear `/dashboard/comisiones`
devuelve una negativa del servidor, no la lista; cancelar, reprogramar o cobrar
la reserva de un compañero devuelve 403; «Crear cuenta e invitar» produce ficha,
membresía y vínculo en una sola operación.

**Métrica.** Porcentaje de ventas con vendedor atribuido y número de vendedores
activos que entran al menos una vez por semana. **Se mide la línea base antes de
desplegar**, o no es criterio de éxito.

**Riesgos.** (a) El sellado cambia a quién se le paga: hay que comunicarlo antes.
(b) Endurecer el residuo «lo de nadie» sin el sellado desplegado dejaría a
alguien sin poder abrir su propia venta: van en la misma versión y en ese orden.
(c) Las guardas de página pueden cerrar accesos que alguien usa de hecho:
inventariar quién abre qué antes de recortar.

---

### Fase 2 — El bolsillo del vendedor · 3 semanas

**Objetivo.** Que vea y descargue su dinero, y se entere solo de lo que le afecta.

1. **Abrir `READ_ROLE` al actor acotado — con una lista propia, NO con
   `SELLER_SCOPED`.** Esta es la trampa del plan original y hay que decirla con
   todas las letras: `SELLER_SCOPED` incluye `price_rule` y `commission_rule`,
   donde `seller_id` es **nulo en la inmensa mayoría de las filas**. Con la
   regla vigente «lo mío **o lo de nadie**», eximir esas dos tablas le abriría al
   vendedor **todas las reglas de precio y de comisión de la empresa y de sus
   socios**. La exención va sobre una lista corta y explícita —`commission`,
   `settlement`, `payable` del propio vendedor— y con una prueba que falle si
   alguien mete una tabla en una lista sin meterla en la otra.
2. **Políticas de seguridad a nivel de fila para cada tabla que se abra.** No es
   opcional ni «camino no crítico»: en producción la RLS está activa o la
   aplicación no arranca. Sin política, la pantalla nueva sale vacía.
3. **`/dashboard/mi-espacio/comisiones`**: devengada, pendiente y pagada por
   período, con referencia de reserva, producto, fecha de venta **y fecha de
   salida**, importe base, **porcentaje congelado** (no el vigente) y marca
   explícita de **anulada por cancelación o no-show**. Es la fuente número uno
   de discusión y la pantalla interna no la separa.
4. **Migración `0070`: fecha de servicio en `commission`.** El mercado liquida
   por fecha de tour; la tabla `commission` solo tiene `created_at`, y la fecha
   de salida vive en `booking → departure`. La capa de consulta **no filtra por
   columna de tabla unida**, así que cortar períodos por fecha de tour exige
   desnormalizar la columna. Sin esto, el punto 3 no se puede cumplir.
5. **`assertSettlementBeneficiary`**, helper único que comprueba pertenencia por
   socio, vendedor o proveedor, usado por `statement`, `statement/pdf` y la
   futura disputa. Hoy `/api/settlements/[id]/statement` solo exige rango: abrirlo
   por rol sin comprobar la fila dejaría descargar liquidaciones de proveedores
   cambiando el identificador en la dirección.
6. **`buildSellerStatementPdf`**, derivado del de proveedor **pero escrito
   aparte**: aquel lleva costos y márgenes.
7. **`/dashboard/mi-espacio/metas`**: rama de `/api/seller-goals` que **ignora el
   parámetro `seller` de la consulta** y usa el contexto.
8. **Avisos dirigidos**: `sale_attributed`, `commission_approved`,
   `settlement_paid`, `booking_cancelled_for_seller`, enviados al usuario
   concreto, **nunca a la audiencia de rol** —que hoy reparte a todos los
   vendedores—; resumen de los lunes por correo, con WhatsApp como preferencia.

**Criterio de hecho.** La comisión pendiente que ve el vendedor coincide al
céntimo con la suma de sus filas abierta por un gerente; su estado de cuenta no
contiene ningún costo ni fila de otro beneficiario; cambiar el identificador por
el de una liquidación de proveedor devuelve 403;
`GET /api/seller-goals?seller=<otro>` devuelve sus propias metas; al pagar una
liquidación solo el beneficiario recibe el aviso, comprobado con dos vendedores;
`GET /api/erp/price_rule` y `/commission_rule` siguen devolviendo 403.

---

### Fase 3 — Vender desde el bolsillo: enlace, QR, catálogo y móvil · 3 semanas

**La mejor relación coste/retorno del plan**: el motor de atribución funciona de
punta a punta y solo lo cierra una guarda de rol.

1. `GET /api/attribution` y la ruta del QR pasan de «gerencia» a «gerencia **o**
   dueño del enlace»; el embudo se fuerza al vendedor del contexto.
2. `/dashboard/mi-espacio/enlace`: ver y crear su enlace (general o por
   producto), copiarlo, descargar el PNG del QR, ver su embudo.
3. **Migración `0071`: el slug lo genera el servidor.** Es único global, así que
   aceptarlo del cliente permitiría ocupar o imitar el de un compañero. Más
   límite de enlaces por vendedor, marca del creador, **límite de tasa en
   `/e/[slug]` y auditoría de creación** —sin eso, probar slugs ajenos mide la
   actividad de un competidor alojado en el mismo sistema.
4. **Ciclo de vida del enlace**: al desactivar la ficha se desactiva su enlace,
   con decisión escrita sobre la cookie ya sembrada y sobre los carteles
   impresos que sobreviven meses en un lobby.
5. `GET /api/seller-portal/catalog`: productos habilitados, precio de venta,
   disponibilidad y comisión **declarada como estimada**, sin costo ni margen.
6. **Aplicación real de `max_discount_pct`** en `/api/pricing/quote` y en la
   creación de la orden. Validado solo en la pantalla no sería un techo.
7. Venta móvil en tres pantallas sobre la lógica del POS; manifiesto con
   aterrizaje en Mi espacio; voucher al cliente por WhatsApp con hora y punto de
   recogida, copia al vendedor, **sin neto ni comisión en el documento**.
   *Pendiente de decidir*: cómo convive el manifiesto por rol con la aplicación
   de control de entrada ya instalada (`start_url` por rol, o segunda app).

**Criterio de hecho.** El vendedor crea su enlace, descarga el QR y, tras una
visita y una compra de prueba, ve las tres etapas de su embudo; pedir el QR del
enlace de otro devuelve 403; el catálogo no contiene `base_cost` en ninguna
fila; una cotización por encima de su techo la rechaza el servidor; una venta
completa desde el teléfono termina con el voucher entregado.

---

### Fase 4 — Desbloquear la empresa asociada y cerrar la puerta trasera · 2 semanas

**Las dos piezas se despliegan en la misma versión**: habilitar el alta sin el
ámbito por organización mete empleados externos en el ERP interno.

1. **El cerrojo provisional va en la PRIMERA versión de esta fase, no al final**:
   si llega `partner_id`, el rol se fuerza a socio. Es trabajo de horas y permite
   arreglar la puerta sin abrir el ERP.
2. `POST /api/team` y `/api/team/invite` aceptan `partner_id`, **validan que esa
   organización es de tipo socio y pertenece a esta operadora** —sin esa
   comprobación, un administrador engancha un usuario a un socio de otra
   operadora—, e insertan la membresía sobre ella.
3. **`isPartnerMember` en el contexto**, derivado del tipo de la organización,
   sustituyendo `role === "partner"` en el layout, el armador de filtros, el
   detalle, la creación de órdenes, el motor de precios, el voucher y el resumen
   del portal. La regla pasa a ser «identificador de socio presente ⇒ acotado».
   **Está repetida en al menos ocho ficheros: inventario por búsqueda y una
   prueba de aislamiento por cada punto.**
4. **Migración `0072`**: `app.can_read_partner` pasa de «solo restringe si el rol
   se llama socio» a «sin identificador ve todo; con identificador, solo lo
   suyo».
5. **Ciclo de vida en el mismo arreglo**: estado `pending` hasta activación,
   versión y fecha de las condiciones aceptadas, y un disparador que limita qué
   roles pueden colgar de una organización de socio.
6. **Recorte de la ficha del socio en un solo punto** (`toPartnerRecord`): fuera
   notas internas y condiciones de gestión, también en las expansiones que
   arrastran la ficha dentro de reservas y órdenes.
7. **El socio gestiona a sus propios usuarios** —alta, baja y rol dentro de su
   empresa—, que es universal en el mercado y hoy depende siempre de la
   operadora. Con segundo factor y último acceso visibles por socio.
8. **Conteo de plan corregido**: contar las membresías de todas las
   organizaciones que cuelgan de la operadora. Medir antes de activar el bloqueo,
   o el día del despliegue hay operadoras por encima de su plan.
9. **Unificación del ámbito**: `partnerScopeFor` y `sellerFilterFor` a un único
   punto de entrada por actor, aquí y no antes, para que la Fase 5 (socio **y**
   vendedor combinados) y la 8 (proveedor) no escriban un tercer módulo paralelo.

**Criterio de hecho.** Un usuario creado desde Configuración con un socio
seleccionado entra y ve su resumen sin que nadie toque la base; el mismo alta con
un socio de otra operadora se rechaza; un usuario con rol `seller` cuya membresía
cuelga de un socio es llevado al portal y solo lee las reservas de su socio; la
ficha del socio ya no devuelve notas internas; el contador de usuarios sube al
crear un usuario de portal; el socio da de alta a un empleado suyo sin
intervención de la operadora.

---

### Fase 5 — El tour center opera · 4 semanas

Convertir el portal de solo lectura en punto de venta: reserva con neto, crédito
y voucher; alta y búsqueda de clientes **propios del socio** (nunca abriendo la
cartera de la operadora); `/portal/vendedores` con su equipo, ventas y comisión
por persona; **sub-login del vendedor del tour center** reutilizando el ámbito de
la Fase 1, con filtro combinado socio **y** vendedor; vouchers **con su marca** y
sin neto; liquidaciones con estado de cuenta propio y **botón de disputa** con
destinatario asignado; en el POS interno, al elegir un socio se listan solo sus
vendedores; reportes propios con **exportación por lista blanca de campos que
falla por omisión** —el exportador genérico no sabe recortar columnas—.

*Cuidado específico*: la tabla de vendedores entra en el ámbito del socio como
**propia** por el campo de socio, nunca como compartida, porque trae condiciones
de los vendedores internos; `seller_goal`, `seller_bonus` y `seller_link` no
tienen columna de socio: se filtran por subconsulta o se deniegan, decidido de
antemano.

**Criterio de hecho.** Un tour center reserva una salida con cupo real y recibe
el voucher con su logo y sin neto; su vendedor entra con sub-login y ve solo sus
propias ventas dentro de las del socio; la exportación del portal no contiene
ningún campo no declarado; abrir la liquidación de otro socio devuelve 403.

---

### Fase 6 — El contrato explícito · 3 semanas

Tabla de enlace socio–producto — **`authorized_products` no es que se descarte
al guardar: es que nada en el sistema puede escribirlo, no está en `writable`
ni en ningún formulario, y el código trata la lista vacía como catálogo
entero**; modelo de precio y de cobro declarados en la relación comercial;
aplicación de la lista **al crear la orden y en las llaves de API**, no solo al
listar; cupos por socio; comunicación al socio (confirmación, cambio de
recogida, cancelación, liquidación emitida) con bandeja filtrada; **tarifario
neto descargable y llaves de API** para el socio que integra; **saldo prepago con
recargas**, además del control de crédito que ya existe.

*Riesgo económico, no de datos*: sin modelo declarado, un socio con precio neto
puede además devengar comisión y **cobrar dos veces**, y se detecta un mes
después en la liquidación. La migración debe sembrar la tabla con todo el
catálogo activo por socio, o corta la venta de los socios existentes.

**Criterio de hecho.** Un producto fuera de la lista de un socio no aparece en su
catálogo **y su reserva por API se rechaza**; un socio con modelo neto no genera
comisión; el tarifario descargado coincide con lo que la API devuelve.

---

### Fase 7 — El dinero en la calle: caja externa y modos de cobro · 3 semanas

Caja y arqueo del punto de venta externo y del vendedor (identificador de socio y
de vendedor en registro y sesión de caja, que hoy solo tienen sucursal y
usuario); **tres modos de cobro declarados**: paga todo el cliente al operador;
cobra el punto de venta y debe el neto; o **el vendedor retiene su comisión como
depósito** y el cliente paga el resto al subir. Cuando se retiene la comisión,
**esa comisión nace marcada como cobrada en la misma escritura** que el
movimiento de caja: hacerlo en dos pasos es exactamente cómo se paga dos veces.
Los movimientos con identificador de socio quedan **excluidos del arqueo
interno**, o el efectivo del tour center aparecerá como caja propia.

**Criterio de hecho.** Un arqueo de la operadora no incluye ni un movimiento de
caja de socio; una venta con comisión retenida deja la comisión en «cobrada» y el
movimiento de caja, o ninguna de las dos; el cierre de turno del vendedor cuadra
por medio de pago.

---

### Fase 8 — El transportista y los demás proveedores · 7 semanas

*Reestimada al alza: en el borrador original eran 5 semanas para más trabajo que
cualquier otra fase.*

Identidad de proveedor con el mismo patrón ya probado dos veces; ámbito por fila
con identificador de proveedor **desnormalizado** en recursos de salida y rutas
de recogida, para filtrar por columna y no por unión; portal con servicios
próximos y pasados; **aceptación o rechazo con su número de confirmación y plazo
declarado —y qué ocurre al vencer: reasignación, alerta o aceptación tácita, hay
que decidirlo—**, también por enlace de un clic **de un solo uso, ligado al
recurso, caducado con la salida, revocable al reasignar y auditado en cada
apertura**; asignación de su propia flota validada contra conflictos y
documentos; hoja de ruta móvil del chofer con recogido y no-show con hora; envío
del manifiesto por correo y WhatsApp; su estado de cuenta, aceptación o disputa y
**carga de factura con NCF**; bloqueo de asignación de vehículos con seguro o
inspección vencidos **en la escritura genérica**, no solo en la mesa de despacho;
y guarda de rango en `/api/operations/dispatch` y la hoja de ruta, que hoy solo
exigen sesión.

**Alcance a decidir:** el encargo dice «transportistas y demás». La tabla
`supplier` cubre también guías, restaurantes y embarcaciones. El mismo portal los
sirve con poco añadido; si se limita a transporte, hay que decirlo.

*Es el actor con más datos personales de terceros en juego*: una hoja de ruta
filtrada es una lista de clientes con hotel, habitación y teléfono. El proveedor
ve solo las paradas de su ruta y solo los campos operativos. El rol nuevo entra
por debajo de vendedor en el rango y **hay que auditar una por una todas las
rutas que exigen rango `seller`** antes de crearlo.

---

### Calendario

| Fase | Entrega | Semanas | Acumulado |
|---|---|---|---|
| 1 | El vendedor es dueño de su venta y tiene dónde verla | 3 | 3 |
| 2 | Su dinero: comisiones, liquidaciones, metas, avisos | 3 | 6 |
| 3 | Enlace, QR, catálogo propio y móvil | 3 | 9 |
| 4 | Alta del socio y ámbito por organización | 2 | 11 |
| 5 | El tour center opera | 4 | 15 |
| 6 | Contrato: catálogo autorizado y modelo comercial | 3 | 18 |
| 7 | Caja externa y modos de cobro | 3 | 21 |
| 8 | El transportista y los demás proveedores | 7 | 28 |

**Semanas-persona de desarrollo puro.** Sin reserva para regresión, migración de
datos, formación ni soporte del cambio de atribución. Con una persona a tiempo
completo, añadir entre un 25 % y un 40 %.

**Por qué este orden.** El vendedor va primero porque lo pidió la dirección,
porque es el actor con más rotación y volumen en Punta Cana, y porque **la pieza
cara ya está escrita**: lo que falta son cierres de escritura y una pantalla. Las
fases 2 y 3 son valor visible que no mueve ninguna barrera de seguridad: **si hay
que recortar plazo, se recorta ahí**, nunca el sellado ni las pruebas. La 4 va
justo después porque contiene un fallo que impide entrar a cualquier socio y una
puerta trasera que no puede quedar abierta cuando el portal empiece a usarse. La
5 precede a la 6 porque el flujo de reserva es lo que hace verosímil el producto
ante un tour center. La caja (7) va después del contrato porque el modo de cobro
determina qué caja existe. El transportista (8) va al final porque es el bloque
más grande, el que más datos personales expone y el único que no genera venta
nueva por sí mismo.

---

## 4. Lo que NO se hará todavía, y por qué

- **Socio que vende para varias operadoras con un solo acceso.** Obligaría a
  revisar todas las consultas que asumen una única operadora. La vía barata, si
  aparece la necesidad, es un selector de operadora dentro del portal sobre las
  membresías existentes, sin tocar el modelo.
- **Auto-registro público de socios.** Exige token firmado, caducidad, estado
  pendiente y moderación. Mientras el alta la haga la operadora (Fase 4), el
  riesgo es cero.
- **Agencia matriz con subagencias consolidadas.** El tipo `subagency` ya existe
  en el esquema; consolidar liquidaciones de una matriz es una fase propia.
- **Ranking entre vendedores.** No existe en **ninguna** plataforma de tours
  revisada. Si se hace, anonimizado o reducido a la posición propia.
- **Recompensas en puntos canjeables para conserjes** (modelo de Ventrata para
  hoteles que prohíben comisión en efectivo). Es una conversación comercial antes
  que un desarrollo.
- **Portal e idioma en inglés, y comisiones en varias monedas.** `seller.currency`
  y `commission.currency` existen en el esquema y nadie los usa. Para agencias
  extranjeras hará falta; no bloquea nada hoy.
- **Unificación del vocabulario de tipos de socio.** Toca cuatro columnas en
  producción para ganar consistencia, no capacidad. Y hay una trampa: **la
  sucursal propia de tipo tour center SÍ ve el ERP**, y migrarla a socio sería un
  error grave de aislamiento.
- **Modo sin conexión para el chofer.** Depende de la cobertura en carretera y
  puede desbordar la Fase 8 por sí solo.

---

## 5. Riesgos transversales

**La compuerta se evalúa antes del ámbito.** Meter una tabla en el ámbito del
vendedor **no la abre**: `READ_ROLE` rechaza por rango antes de que el filtro por
fila llegue a aplicarse. *Mitigación*: exención sobre una lista corta y explícita
—no sobre `SELLER_SCOPED`, que incluye las reglas de precio— con una prueba que
falle si alguien añade una tabla a una lista sin añadirla a la otra.

**El fallo silencioso.** Un filtro sobre una columna que no existe no da error:
devuelve la empresa entera. Ya hubo un precedente evitado por poco —el ámbito usa
los nombres del **recurso** (`order`), no los de Postgres (`sales_order`)—.
*Mitigación*: la prueba que valida cada campo declarado contra el recurso ya
existe; falta extenderla al esquema real.

**El menú no es una barrera.** 5 de 129 páginas miran el rol en servidor, y
ninguna de ellas enseña dinero. *Mitigación*: guardas en la Fase 1, y la norma de
que toda pantalla nueva de actor externo nace con guarda en el layout.

**La exportación.** Listado y exportación comparten el armador de filtros y por
eso no pueden discrepar; pero el exportador **no sabe recortar columnas** y
repite por su cuenta la misma compuerta de rol que el listado. *Mitigación*: el
recorte vive en el módulo de proyección y se aplica en los tres puntos, con un
test que falle si uno queda sin migrar.

**El aislamiento por nombre de rol.** Mientras el ámbito dependa de que el rol se
llame «partner» y el identificador de socio se rellene para cualquier rol, hay
una puerta latente. Hoy es latente porque el alta está rota; se cierra en la
misma versión que la arregla.

**La seguridad a nivel de fila está activa en producción.** Cada tabla que se
abra a un actor nuevo necesita su política **en la misma fase**, o la pantalla
sale vacía. No es trabajo diferible.

**Identidad y dinero.** `seller.user_id` decide de quién son las ventas y a quién
se le paga. El índice único parcial ya está (`0069`); falta el permiso por campo,
la validación contra membresía activa y la auditoría de cada cambio.

**Datos personales de terceros.** El embudo, la hoja de ruta y el manifiesto
llevan nombres, teléfonos y habitaciones. Los enlaces sin sesión son de un solo
uso, caducan con la salida, se revocan al reasignar y cada apertura queda
auditada.

**Dinero que se paga dos veces.** Comisión retenida como depósito, no-show
marcado en campo, disputa de liquidación: los tres mueven dinero desde fuera de
la operadora. Escritura en una sola operación, auditoría y reversibilidad por
gerencia.

**Regresiones.** Cada fase que abre datos entra **con su prueba de aislamiento en
la misma fase**, no después.

---

## 6. Decisiones que no son técnicas y hacen falta antes de la Fase 1

1. **¿El sellado de la venta reatribuye comisiones ya devengadas?** Al forzar
   `seller_id` al vendedor que factura, hay ventas históricas atribuidas a otro
   —o a nadie— cuya comisión ya se calculó. Opciones: no tocar el pasado (lo
   recomendado), recalcular desde una fecha, o recalcular todo. **Cambia lo que
   se le paga a gente real.**
2. **¿Las cuentas de vendedor cuentan contra `max_users` del plan?** Con decenas
   de representantes de hotel, es una decisión de precio del producto, no de
   ingeniería.
3. **¿Qué se le ofrece a un tour center contratado mientras llega la Fase 4?**
   Con el cerrojo provisional en la primera versión de esa fase, el intervalo se
   acorta; si hay socios esperando hoy, conviene adelantarla.
4. **¿La Fase 8 cubre solo transporte, o todos los proveedores** (guías,
   restaurantes, embarcaciones)?
5. **Tamaño y dedicación del equipo**, para convertir las semanas-persona en
   calendario.

---

## 7. Trazabilidad

Este plan procede de un análisis de 23 agentes (mapa de 6 actores, 5 temas de
mercado, 78 brechas, 3 planes independientes, 2 jueces, síntesis y crítica
adversarial). **La crítica encontró errores de hecho en la síntesis y aquí están
corregidos**: el índice único ya existía, las pruebas del ámbito ya existían, la
cifra de páginas con guarda de rol era 5 y no 2, la numeración de migraciones
estaba corrida, la exención de `READ_ROLE` tal como estaba propuesta abría las
reglas de precio, y la comisión por fecha de tour era imposible sin migración.
Todo dato de la sección 1 fue reverificado contra el repositorio.
