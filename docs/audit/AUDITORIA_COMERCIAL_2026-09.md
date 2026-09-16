# Auditoría comercial — ¿está Park & Tours listo para venderse?

Fecha: 2026-09-16. Base auditada: `main` en `1d5556b` (tras la Ola 2 y la
integración con MembeGo).

Esta auditoría responde una sola pregunta: **¿puede este sistema venderse hoy
a una operadora turística que no sea el propio dueño, y qué falta para que
sea un producto profesional y completo?** Se hizo leyendo el código, no la
documentación: cada cifra de abajo sale de un comando sobre el repositorio.

---

## 1. Veredicto ejecutivo

**Se puede vender HOY a un cliente piloto acompañado. No se puede vender
todavía como SaaS abierto.** Son dos cosas distintas y conviene no
confundirlas:

| Escenario | ¿Listo? | Por qué |
|---|---|---|
| Uso propio (tu operadora) | **Sí** | El núcleo operativo está profundo y verificado. |
| 1–3 clientes piloto con acompañamiento | **Sí, con condiciones** | Falta que el cliente pueda valerse solo: importación de datos, exportaciones, soporte, documentación de usuario. Tú puedes suplirlo a mano mientras tanto. |
| SaaS abierto (registro → pago → uso sin ti) | **No** | Los planes existen en la base pero **no se aplican**; no hay motor de reservas público; no hay API para agencias; no hay medición de uso; no hay proceso de recuperación ante fallos del cliente. |

**Lo que está bien de verdad** (y es la mitad que más cuesta construir): el
motor de precios con snapshot inmutable, el anti-oversell recalculado desde
las reservas, la caja multimoneda con arqueo ciego y revisión, los cobros con
plan de cuotas y aging, la liquidación a proveedores con retenciones ISR/ITBIS,
la facturación con NCF, las cotizaciones por versiones y opciones, el
manifiesto de salida, comunicaciones con bandeja de salida idempotente, PDFs de
todos los documentos, RLS por inquilino verificado en Postgres real, y 780
pruebas que se ejecutan en CI con guardas durables. Eso no es «formularios
genéricos»: es un ERP turístico con reglas de negocio reales.

**Lo que aún es genérico:** 35 de las 91 pantallas del panel (38 %) son
`SimpleResource`, es decir, tabla + formulario sin lógica propia. Muchas son
catálogos donde eso es correcto (categorías, monedas, cajas). Pero **ocho
módulos enteros** están en ese estado y para un cliente son la diferencia
entre «tiene el módulo» y «el módulo sirve»: Equipo/RR. HH., Comercio
(inventario), Distribución (allotments), Membresías de clientes, Vouchers,
Casos de huésped, Recursos/Rutas de operaciones y Fiscal/Secuencias.

**Los tres huecos que impiden vender sin ti**: (1) **no hay monetización
real** — el plan no limita nada, el trial no expira, nadie sabe cuánto usa
cada empresa; (2) **no hay puerta de entrada de la demanda** — sin motor de
reservas público ni API para agencias, el cliente sigue vendiendo por WhatsApp
y tecleando; (3) **no hay salida ni entrada de datos** — sin importar sus
clientes/productos ni exportar sus informes, ningún negocio se muda.

---

## 2. Método y evidencia

| Medida | Valor |
|---|---|
| Pantallas del panel | 104 (91 con contenido; 13 índices de sección) |
| Pantallas genéricas (`SimpleResource`) | 35 |
| Pantallas dedicadas (lógica propia) | 56 |
| Recursos ERP registrados | 88 |
| Tablas en migraciones | 98 (41 migraciones, todas aditivas e idempotentes) |
| Rutas de API | 90 (42 acciones dedicadas + CRUD genérico) |
| Motores de dominio puros | 18 archivos, 4 861 líneas, sin acceso a base |
| Pruebas | 780 en 38 archivos (vitest) + harness SQL en Postgres 16 real + 2 E2E |
| Documentos PDF | 6 (voucher, cotización, manifiesto, factura, arqueo, estado de cuenta) |
| Crons | 3 (diarios; plan Hobby de Vercel) + despacho al terminar la petición |
| Roles | 8 (superadmin, owner, admin, manager, operations, cashier, seller, partner) |
| Rutas mutantes con guarda CSRF | 100 % (guarda automática en CI) |
| Rutas con `requireTenant` | todas salvo cron/webhooks (secreto) y superadmin (rol) |

Escala de profundidad usada en las tablas siguientes:

- **5 · Vendible** — reglas de negocio reales, estados, documentos, pruebas.
- **4 · Sólido** — funciona de punta a punta; le faltan detalles de producto.
- **3 · Utilizable** — lógica real pero cubre solo el caso principal.
- **2 · Genérico** — tabla + formulario; el dato existe, el proceso no.
- **1 · Esqueleto** — pantalla o tabla sin uso real.

---

## 3. Módulo por módulo

### 3.1 Ventas y reservas (el corazón)

| Módulo | Prof. | Qué hay | Qué le falta para vender |
|---|---|---|---|
| **POS / venta directa** (`pos`, 888 líneas) | 4 | Cotización en vivo por motor de precios, cliente en el acto, extras, pago inmediato, comisión al vendedor. | Venta a crédito con límite ya existe; falta **modo kiosco/táctil** para mostrador, **impresora térmica** (ESC/POS) para recibos, **lector de código** para redimir. |
| **Reservas** (`reservas`, 674 líneas) | 4 | Ciclo completo, cancelación con política y reembolso calculado, check-in, voucher, extras, plan de pagos, historial. | **Reprogramación** (cambiar de salida sin cancelar y recrear), **reserva de grupo con rooming/lista de pasajeros importable**, **notas operativas por pasajero**, **lista de espera** cuando el cupo está lleno. |
| **Cotizaciones** (`ventas/cotizaciones`) | 5 | Versiones, opciones alternativas, depósito, inclusiones/exclusiones, PDF, aceptación, conversión a reserva con precio negociado inmutable. | **Aceptación en línea** por el cliente (enlace público con firma) en vez de «aceptada» tecleada por el vendedor. |
| **Tickets / entradas** (`ventas/tickets`) | 4 | Emisión, redención, anulación, control de usos. | **QR real** (hoy el check-in no escanea: 0 referencias a cámara/lector) — es la primera cosa que un parque pide. |
| **Motor de precios** (`pricing.ts`) | 5 | Prioridad vendedor > partner > canal > regla > modalidad > base; temporadas (`season_from/to`) y vigencias; snapshot inmutable; precio negociado del lado servidor. | **Tramos por pax** (`min_pax/max_pax/tiers` existen en la base pero el motor no los lee), **promo codes** aplicados por el motor (las promociones existen como registro y nada las aplica), calendario visual de tarifas. |
| **Disponibilidad** (`availability.ts`) | 5 | Anti-oversell recalculado desde reservas; allotments por partner. | **Holds temporales** (bloquear cupo 10 minutos mientras se paga) para un motor de reservas público. |
| **Extras vendibles** | 4 | Catálogo, precio por pax/por reserva, en documentos. | Inventario de extras (cupo de equipos, tallas). |
| **Promociones** | 2 | Registro de promociones. | Que el motor de precios las aplique y las audite. |
| **Gift cards** | 4 | Emisión, saldo, canje parcial, reembolso, anulación, movimientos. | Diseño imprimible/enviable por correo. |

### 3.2 Operaciones

| Módulo | Prof. | Qué hay | Qué le falta |
|---|---|---|---|
| **Salidas** (`salidas`, 506) | 5 | Generación por calendario, cupo, cierre con pax reales/no-show, notas de guía e incidentes. | Vista **calendario** (hoy es lista), duplicar/plantillas de temporada. |
| **Manifiesto** (535 + PDF) | 5 | Lista de pasajeros con dieta/idioma/hotel/pickup, PDF, cierre con pax reales. | Versión **móvil para el guía** con check-in por pasajero desde el teléfono (offline). |
| **Despacho** (`operaciones/despacho`, 346) | 4 | Asignación de vehículo, guía y recursos por salida. | Conflictos de doble asignación en pantalla, planificación semanal. |
| **Pickups** (227) | 4 | Rutas, horas, hoteles, lista por conductor. | Optimización de orden, mapa, notificación al cliente con hora. |
| **Check-in** (354) | 3 | Búsqueda por código/nombre, marcaje. | **Escáner QR**, kiosco de autoservicio, offline. |
| **Transporte / vehículos** | 3 | Flota, mantenimiento vinculado. | Kilometraje/combustible por salida, documentos con vencimiento. |
| **Recursos y rutas** | 2 | Tablas genéricas. | Sin lógica: no bloquean ni avisan. |
| **Aprobaciones** | 4 | Solicitudes con caducidad automática (cron), decisión auditada. | Notificar al aprobador (hoy lo ve al entrar). |
| **Mi día / Tareas / Notificaciones** | 3 | Agenda por rol, tareas generadas por impacto de activos. | **Nadie escribe notificaciones**: la tabla existe, la pantalla existe, ningún módulo inserta. Es un módulo muerto hasta que se conecte a eventos (reserva nueva, pago, cupo lleno, aprobación pendiente). |

### 3.3 Dinero

| Módulo | Prof. | Qué hay | Qué le falta |
|---|---|---|---|
| **Caja** (542) | 5 | Sesiones, movimientos, arqueo por denominaciones, multimoneda, ciego, revisión de supervisor, PDF, asientos. | Cierre de día consolidado multi-caja (reporte), depósito bancario del efectivo. |
| **Cobros / vencimientos** | 5 | Plan de cuotas, saldo, aging sincronizado, recordatorios automáticos, límite de crédito y liberación de hold. | Cobro en línea del saldo por enlace (no hay pasarela por decisión del dueño → alternativa: **transferencia con conciliación manual asistida**). |
| **Pagos** (298) | 4 | Multi-método, asignación derivada, reembolsos. | Conciliación bancaria (importar estado de cuenta y cruzar). |
| **Facturación fiscal** (434) | 4 | NCF por secuencia, ITBIS, emisión/anulación, PDF, asientos. | **Reportes DGII 606/607/608** (obligatorios en RD: hoy no existen), factura electrónica e-CF cuando aplique, notas de crédito/débito con NCF propio. |
| **Liquidación a proveedores** | 5 | Devengo congelado en la venta, conciliación con disputa, retenciones ISR/ITBIS con override, pago parcial, estado de cuenta PDF. | Envío del estado de cuenta por correo al proveedor con un clic. |
| **Comisiones y liquidaciones a socios** | 4 | Motor por reglas, generación, aprobación, pago. | Portal del vendedor (ver sus comisiones), disputas. |
| **Contabilidad** (ledger) | 3 | Plan de cuentas, asientos automáticos, libro diario, balance de comprobación. | **Estados financieros** (resultados y balance general), cierre de periodo, exportación a contador (CSV/Excel). Sin esto el contador del cliente no lo usará. |
| **Gastos** | 3 | Registro con categorías, cuentas por pagar. | Adjuntar comprobante (imagen), aprobación por monto. |
| **Rentabilidad** (215) | 4 | Margen por producto con costos devengados. | Por salida, por canal, por vendedor. |
| **Cuentas, divisas, cajas, secuencias, fiscal** | 2 | Catálogos genéricos. | Correcto que sean genéricos; solo «Fiscal» merece pantalla propia (perfiles de impuestos por producto). |

### 3.4 Clientes y canal

| Módulo | Prof. | Qué hay | Qué le falta |
|---|---|---|---|
| **Directorio de clientes** | 3 | Ficha, historial, etiquetas, origen (incluido MembeGo). | **Importación CSV/Excel**, deduplicación, exportación, consentimiento (GDPR/Ley 172-13 RD). |
| **CRM** (262) | 3 | Leads, actividades, etapas. | Embudo con métricas de conversión, recordatorios, plantillas de seguimiento. |
| **Comunicaciones** (311) | 5 | Plantillas por evento, correo (Resend) y WhatsApp (Meta), bandeja de salida idempotente, dedupe, adjuntos, despacho al terminar la petición + barrido. | Idioma del cliente en la plantilla, SMS, historial en la ficha del cliente. |
| **Membresías de clientes** | 2 | Genérico. | Con MembeGo conectado, este módulo **debe desaparecer o convertirse en espejo de solo lectura**: duplicar la fuente de verdad es peor que no tenerlo. |
| **Casos de huésped** | 2 | Genérico. | Flujo de resolución con SLA y comunicación. |
| **Vouchers** | 2 | Genérico (el voucher real sale de la reserva). | Retirar o fusionar con la vista de reservas. |
| **Partners B2B / portal** | 4 | Portal con resumen, catálogo, reservas, liquidaciones; allotments; balances. | **API para agencias** (hoy no hay claves de API), tarifario neto descargable, confirmación por correo al partner. |
| **Vendedores** | 3 | Ficha, reglas de comisión. | Portal/vista propia con sus ventas y comisiones. |

### 3.5 Parque y mantenimiento

| Módulo | Prof. | Qué hay | Qué le falta |
|---|---|---|---|
| **Parque** (atracciones, zonas, accesos, inspecciones, incidentes, checklists, bitácora) | 4 | Estados de atracción con impacto en tareas, accesos por ticket, inspecciones con plantilla, incidentes con acciones. | Waivers con **firma digital real** (hoy solo el registro «firmado»), aforo en tiempo real por zona. |
| **Mantenimiento** (activos, órdenes, planes, repuestos) | 4 | Órdenes, planes preventivos, impacto en atracciones. | Calendario preventivo automático (generar órdenes desde el plan), costo por orden a contabilidad. |

### 3.6 Equipo y administración

| Módulo | Prof. | Qué hay | Qué le falta |
|---|---|---|---|
| **Equipo / RR. HH.** (turnos, asistencia, certificaciones, documentos, acuses) | 2 | Cinco tablas genéricas. | Lógica: turnos → asignación a salidas, asistencia → horas trabajadas → nómina o exportación, certificaciones **con vencimiento que bloquee la asignación** (un guía sin certificación vigente no puede ir en el manifiesto). |
| **Comercio / inventario** (artículos, almacenes, existencias, movimientos, compras) | 2–3 | Motor de inventario con kardex y bajo stock; compras genéricas. | Recepción de compra que mueva stock, venta de artículos desde el POS, costo promedio. |
| **Distribución** (allotments, reglas) | 2 | Genérico; el motor de disponibilidad sí lee allotments. | Pantalla de cupo por partner y fecha (matriz), liberación automática. |
| **Configuración** (815) | 4 | Empresa, sucursales, catálogos, políticas, cajas, divisas. | Personalización de documentos (logo, colores, textos legales por documento), numeraciones por sucursal. |
| **Sucursales** | 2 | Genérico; una docena de recursos llevan `branch_id`. | **Ámbito por sucursal en la sesión** (ver solo mi sucursal) y en informes. |
| **Auditoría** | 4 | Bitácora inmutable con IP/agente, severidad, filtros. | Exportación, retención configurable. |
| **Integraciones** | 3 | MembeGo profundo (SSO + webhooks + panel); el resto es un registro genérico. | Ninguna OTA real (Viator, GetYourGuide, Expedia): solo etiquetas. Esto es **estratégico**, no cosmético (ver §5). |

---

## 4. Transversales: lo que hace que un software sea un producto

Esto es lo que separa «funciona para mí» de «lo compra otro».

### 4.1 Monetización — 🔴 crítico
- La tabla `plan` tiene `max_users`, `max_bookings_month`, `max_storage_mb`,
  `max_products`, `trial_days`, `modules_enabled`. **Ninguna ruta lee esos
  límites.** `modules_enabled` solo oculta el menú (`nav.ts`); la API acepta
  todo. `trial_days` no caduca nada.
- Stripe cobra la suscripción y actualiza la organización, pero **nada bloquea
  a una empresa impagada**.
- No hay **medición de uso** (reservas/mes, usuarios activos, almacenamiento)
  → no se puede facturar por uso ni saber a quién subir de plan.

### 4.2 Entrada y salida de datos — 🔴 crítico
- **Importación**: cero. Un cliente nuevo tiene cientos de clientes, decenas
  de productos y su histórico de reservas. Sin importador, la migración es
  manual y nadie se muda.
- **Exportación**: solo 5 pantallas exportan CSV (reservas, salidas, manifiesto,
  cotizaciones, tickets). Ni clientes, ni pagos, ni facturas, ni contabilidad.
  El contador del cliente pedirá Excel el primer mes.

### 4.3 Puerta de la demanda — 🟠 estratégico
- **Sin motor de reservas público**: no hay página donde el turista escoja
  fecha, pax y reserve. Todo entra por el equipo. Dado que la pasarela de
  pago está descartada, el motor puede terminar en **«reserva confirmada con
  pago a la llegada / transferencia»** y seguir siendo enormemente valioso.
- **Sin API para agencias ni OTAs**: las agencias grandes conectan por API o
  por canal; sin esto el cliente no puede crecer más allá de su mostrador.

### 4.4 Cuentas y acceso — 🟠 importante
- Invitación de equipo = crear usuario **con contraseña tecleada por el admin**
  y `email_confirm: true`. Falta invitación por correo con enlace.
- Sin **recuperar contraseña** desde la app (Supabase lo soporta; no hay pantalla).
- Sin **2FA** para owner/admin (un ERP con dinero debe ofrecerlo).
- Roles jerárquicos (8) sin **permisos finos** ni ámbito por sucursal.

### 4.5 Robustez operativa — 🟡 necesario
- Rate limit **en memoria por instancia**: en Vercel serverless cada instancia
  tiene su mapa → protección real casi nula. Necesita almacén compartido
  (Upstash/Redis o tabla en Postgres con ventana).
- Crons diarios por plan Hobby: el recordatorio de saldo y la caducidad de
  aprobaciones llegan con hasta 24 h de retraso. Vender exige plan Pro (o
  un runner externo).
- Sentry cableado pero sin DSN por defecto; sin alertas de negocio (pago
  fallido, webhook rechazado, cola atascada).
- Sin **estado del sistema** para el cliente ni página de incidencias.
- Backups: dependen del plan de Supabase (PITR solo en Pro). Sin **exportación
  completa por empresa** («llévate tus datos»), que además es exigencia legal
  razonable.

### 4.6 Producto y soporte — 🟡 necesario
- Sin documentación de usuario, sin tour de onboarding en la app, sin centro
  de ayuda. El `demo-seed` (608 líneas) es un gran activo para demos.
- Sin i18n: todo en español. Suficiente para RD/LatAm; bloquea Caribe
  anglófono.
- Sin PWA/offline: el guía en la playa sin señal no puede hacer check-in.
- Documentos: sin personalización por empresa (logo/colores/textos), que es lo
  primero que un cliente mira en su voucher.

### 4.7 Legal RD — 🟠 importante para el nicho
- 606/607 (compras/ventas) no existen; sin ellos la facturación con NCF está
  a medias frente a DGII.
- Aviso de privacidad y términos existen como páginas; falta consentimiento
  registrado por cliente y política de retención.

---

## 5. Estrategia de implementación y crecimiento

### 5.1 Posicionamiento

No competir como «software de tours genérico» contra Rezdy/FareHarbor/Bókun
(motor de reservas + pasarela, en inglés, pensados para vender online). Tu
ventaja es otra y ya está construida: **el ERP completo de la operadora
dominicana/latinoamericana** — caja en efectivo real, NCF, ITBIS/ISR a
proveedores, comisiones a vendedores y agencias, liquidaciones, pickups de
hotel, parques con mantenimiento — más la **fidelización integrada con
MembeGo**, que ningún competidor tiene. El cliente objetivo: operadoras de
excursiones, parques y atracciones de 5 a 80 empleados que hoy viven en
Excel + WhatsApp y a las que un software gringo no les cuadra la caja.

### 5.2 Modelo comercial propuesto

| Plan | Para quién | Incluye | Límite natural |
|---|---|---|---|
| **Operador** | Operadora pequeña | Ventas, reservas, salidas, caja, cobros, comunicaciones | 3 usuarios, 300 reservas/mes |
| **Profesional** | Operadora con agencias y proveedores | + partners/portal, comisiones, liquidaciones a proveedores, facturación NCF, contabilidad | 10 usuarios, 2 000 reservas/mes |
| **Parque** | Parques y atracciones | + parque, mantenimiento, accesos QR, inventario, RR. HH. | 30 usuarios |
| **Enterprise** | Multi-sucursal | + API, sucursales con ámbito, SSO, SLA | a medida |

Todo esto ya lo modela `plan.modules_enabled` + límites: **falta aplicarlo**.
MembeGo se ofrece como complemento cruzado (la fidelización trae clientes
recurrentes al operador, y el operador trae empresas a MembeGo).

### 5.3 Fases (con criterio de salida, sin fechas)

Cada fase termina cuando su criterio se cumple con pruebas y guardas, igual
que las olas anteriores.

**Ola 3 — Vendible a pilotos (lo que impide cobrar)**
1. **Aplicación de planes**: `requireTenant` carga el plan; guardas de
   `max_users` (invitación), `max_bookings_month` (creación), módulos en la
   API (no solo en el menú); trial con caducidad y estado `past_due` que
   bloquea escritura pero no lectura. Pantalla «Tu plan y uso» con medidores.
2. **Importador universal** (clientes, productos, modalidades, precios,
   proveedores, reservas históricas): CSV/Excel con mapeo de columnas,
   validación previa, informe de errores por fila, deduplicación.
3. **Exportación en todos los listados** (CSV/Excel) + **exportación completa
   de la empresa** (ZIP con todas las tablas) desde Configuración.
4. **Cuentas**: invitación por correo, recuperar contraseña, 2FA opcional para
   admin/owner.
5. **Rate limit compartido** y crons en plan Pro (o runner externo).
6. **Notificaciones vivas**: los eventos de negocio escriben en la tabla
   (reserva nueva, pago recibido, cupo al 90 %, aprobación pendiente, webhook
   fallido) → campana + resumen diario por correo.
   *Criterio de salida: una empresa desconocida se registra, importa sus datos,
   invita a su equipo, opera un mes y recibe factura de suscripción sin que tú
   toques la base.*

**Ola 4 — La puerta de la demanda**
1. **Motor de reservas público** por empresa (`/r/{slug}`): productos,
   calendario de salidas con disponibilidad real, extras, datos de pasajeros,
   hold de cupo de 15 min, confirmación con pago a la llegada/transferencia,
   voucher por correo/WhatsApp. Widget embebible en la web del cliente.
2. **Aceptación en línea de cotizaciones** (enlace firmado, el cliente elige
   opción y acepta; deja constancia).
3. **QR de verdad**: voucher y ticket con QR firmado; check-in con cámara
   (BarcodeDetector + fallback), kiosco, **PWA offline** para el guía.
4. **Reprogramación** de reservas y **lista de espera**.
   *Criterio de salida: el 30 % de las reservas de un piloto entran sin que su
   equipo las teclee.*

**Ola 5 — Profundidad de los módulos genéricos**
1. **RR. HH.**: certificaciones con vencimiento que bloquean asignación,
   turnos → despacho, asistencia → horas → exportación de nómina.
2. **Inventario**: recepción de compras mueve stock, artículos vendibles en
   POS, costo promedio, a contabilidad.
3. **Contabilidad**: estados financieros, cierre de periodo, exportación al
   contador; **606/607/608 DGII**; notas de crédito con NCF.
4. **Distribución**: matriz de cupo por partner/fecha, liberación automática.
5. **Sucursales con ámbito** en sesión e informes.
6. **Personalización de documentos** (logo, colores, textos legales).
7. Retirar/fusionar: Membresías (espejo MembeGo), Vouchers (vista de reservas).

**Ola 6 — Ecosistema y escala**
1. **API pública** con claves por empresa y scopes (agencias, OTAs, contables).
2. **Conectores OTA** empezando por uno (Viator o GetYourGuide) con
   sincronización de disponibilidad y reservas entrantes.
3. **Canje de beneficios MembeGo desde el POS** (API de plataforma con las
   credenciales ya previstas).
4. **Analítica**: cohortes de clientes, previsión de ocupación, alertas.
5. **i18n** (inglés) para el Caribe.

### 5.4 Crecimiento

- **Piloto de 3 clientes** de tu red con precio de fundador y acompañamiento
  semanal: cada fricción que encuentren es un ítem de la Ola 3. No firmar el
  cuarto hasta que el tercero opere sin llamarte.
- **MembeGo como canal**: cada empresa de excursiones en MembeGo es un lead
  natural; el botón «Park & Tours» en su lanzador es el anuncio.
- **Onboarding asistido como producto**: cobrar la migración de datos hasta
  que el importador la haga sola; luego, regalarla como cierre.
- **Comunidad y contenido**: guías de «cómo cuadrar caja de excursiones»,
  «NCF para operadoras» — el conocimiento fiscal local es tu diferenciador y
  atrae al cliente correcto.
- **Métricas que importan** (instrumentar en Ola 3): empresas activas,
  reservas/mes por empresa, % reservas creadas sin teclear (Ola 4), retención
  a 90 días, ingreso por empresa.

---

## 6. Riesgos que no aparecen en la lista de funciones

1. **Dependencia de una sola persona**: sin documentación de usuario ni
   runbooks de operación, tú eres el soporte, el implantador y el DevOps.
   La Ola 3 debe dejar runbooks escritos (alta de cliente, incidente de
   webhook, restauración de backup).
2. **Vercel Hobby + Supabase Free** son planes de laboratorio: sin PITR, con
   crons diarios y sin SLA. Vender exige subir ambos antes del primer cliente
   pagando.
3. **Sin pasarela de pago por decisión**: correcto para RD (efectivo y
   transferencia dominan), pero conviene dejar el punto de extensión listo
   (`payment.method = 'online'`, conciliación) para el día que un cliente lo
   pida.
4. **Deuda de pantallas genéricas**: `SimpleResource` es una gran herramienta
   para catálogos y una trampa para procesos. La regla para adelante: si el
   módulo tiene un *estado* o un *documento*, no puede ser `SimpleResource`.

---

## 7. Resumen en una línea por decisión

- **¿Vender ya?** A pilotos acompañados, sí. Abierto, después de la Ola 3.
- **¿Qué construir primero?** Planes que se apliquen, importador, exportaciones,
  cuentas completas, notificaciones vivas. Nada de eso es vistoso; todo es lo
  que impide cobrar.
- **¿Dónde está la ventaja?** ERP completo local (caja, NCF, retenciones,
  comisiones) + MembeGo. Defenderla con profundidad, no con amplitud.
- **¿Qué no hacer?** No abrir módulos nuevos hasta que los ocho genéricos
  tengan proceso, y no perseguir OTAs antes de tener API y motor propio.
