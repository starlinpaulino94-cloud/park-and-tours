# Arquitectura de navegación

> Refactor de **Information Architecture**, no cosmético.
> `PLATAFORMA → WORKSPACE → GRUPO → MÓDULO → TAREA`

Documento vivo: es la fuente de verdad de la navegación. La implementación
declarativa correspondiente vive en [`src/lib/nav.ts`](../src/lib/nav.ts).

---

## 1. Problema que resuelve

El sistema cubre parques, excursiones, tour centers, tour operadores, DMC,
agencias, transporte, finanzas, inventario, clientes, personal, mantenimiento y
seguridad: **86 rutas** en el panel interno. Antes del refactor el nivel 1 tenía
**13 dominios**, y tres de ellos (Ventas, Catálogo, Distribución) eran facetas
del mismo trabajo: vender.

Principio aplicado:

> El sistema puede tener cientos de funcionalidades, pero el usuario solo debe
> ver unos pocos dominios. Entrar en uno debe sentirse como entrar a un sistema
> especializado dentro del sistema.

Resultado: **10 workspaces**, 0 módulos eliminados, 0 módulos nuevos, 0 rutas rotas.

---

## 2. Nivel 1 — workspaces globales

| # | Workspace | Ruta | Icono | Para qué entra el usuario |
|---|-----------|------|-------|---------------------------|
| 1 | Inicio | `/dashboard` | `LayoutDashboard` | Ver el pulso del negocio y qué le toca hoy |
| 2 | Comercial | `/dashboard/comercial` | `ShoppingCart` | Generar ingresos: vender, definir la oferta y distribuirla |
| 3 | Operaciones | `/dashboard/operaciones` | `Radar` | Ejecutar la experiencia del día y sostener los activos |
| 4 | Parque | `/dashboard/parque` | `FerrisWheel` | Operar atracciones, aforo, accesos y seguridad |
| 5 | Comercio | `/dashboard/comercio` | `Store` | Tienda, A&B, inventario y compras |
| 6 | Clientes | `/dashboard/clientes` | `Users` | Relación con el visitante: ficha, fidelización y experiencia |
| 7 | Finanzas | `/dashboard/finanzas` | `Wallet` | Cobrar, pagar, facturar y contabilizar |
| 8 | Equipo | `/dashboard/equipo` | `UsersRound` | Personas: ficha, turnos, certificaciones y SOP |
| 9 | Analítica | `/dashboard/analitica` | `TrendingUp` | Análisis consolidado y transversal |
| 10 | Administración | `/dashboard/administracion` | `Settings` | Gobierno global de la plataforma |

**Administración** va anclada abajo en el sidebar (junto a Ayuda y Perfil), como
en las plataformas de referencia. No es un cajón de sastre: solo contiene
organización, gobierno y plataforma.

---

## 3. Nivel 2 — navegación contextual por workspace

Al entrar a un workspace, el panel contextual se **reemplaza por completo**. No
hay acordeones simultáneos de varios dominios.

```
Inicio
  Panel          Panel ejecutivo · Mi día
  Pendientes     Tareas · Notificaciones

Comercial
  Ventas         POS · Reservas · Salidas · Tickets · Cotizaciones
  Pipeline       CRM y leads · Vendedores · Promociones
  Catálogo       Productos · Modalidades · Categorías · Precios · Costos ·
                 Políticas · Planes de membresía
  Distribución   Tour centers · Allotments · Reglas de comisión ·
                 Comisiones · Liquidaciones · Portal B2B ↗

Operaciones
  Día de operación   Despacho · Check-in · Pickups · Rutas
  Recursos           Transporte · Asignación
  Mantenimiento      Activos · Fuera de servicio · Órdenes · Preventivos · Repuestos

Parque
  Operación      Centro de control · Atracciones · Zonas · Accesos · Bitácora
  Seguridad      Incidentes · Acciones · Waivers · Plantillas ·
                 Inspecciones · Checklists

Comercio
  Inventario     Artículos · Existencias · Movimientos · Almacenes
  Compras        Órdenes de compra · Proveedores

Clientes
  Base           Directorio
  Fidelización   Membresías · Gift cards · Vouchers
  Experiencia    Casos y reclamos

Finanzas
  Caja           Caja y turnos · Cajas registradoras
  Tesorería      Pagos · Tipos de cambio
  Cuentas        Por cobrar · Por pagar · Gastos
  Facturación    Facturación · Perfiles fiscales
  Contabilidad   Plan de cuentas · Libro diario

Equipo
  Personas       Personal · Certificaciones
  Organización   Turnos · Asistencia
  Conocimiento   Documentos y SOP · Acuses

Analítica
  Rentabilidad   Rentabilidad
  Reportes       Reportes operativos

Administración
  Organización   Configuración · Sucursales · Hoteles
  Gobierno       Aprobaciones · Auditoría
  Plataforma     Integraciones
```

Profundidad máxima respetada: **Workspace → Grupo → Módulo**. Ningún cuarto nivel.

---

## 4. Inventario e matriz de migración

Las **86 rutas** existentes, con su ubicación anterior y la nueva. La columna
*Ruta* no cambia salvo donde se indica: las URLs actuales se conservan.

### 4.1 Inicio

| Módulo | Ruta | Antes | Ahora | Rol mínimo | Capacidad |
|---|---|---|---|---|---|
| Panel ejecutivo | `/dashboard` | Inicio › Panel | Inicio › Panel | seller | — |
| Mi día | `/dashboard/inicio/mi-dia` | Inicio › Panel | Inicio › Panel | seller | — |
| Tareas | `/dashboard/inicio/tareas` | Inicio › Pendientes | Inicio › Pendientes | seller | — |
| Notificaciones | `/dashboard/inicio/notificaciones` | Inicio › Pendientes | Inicio › Pendientes | seller | — |

### 4.2 Comercial *(fusiona Ventas + Catálogo + Distribución)*

| Módulo | Ruta | Antes | Ahora | Rol mínimo | Capacidad |
|---|---|---|---|---|---|
| POS | `/dashboard/pos` | Ventas › Mostrador | Comercial › Ventas | seller | — |
| Reservas | `/dashboard/reservas` | Ventas › Reservas | Comercial › Ventas | seller | `bookings` |
| Salidas | `/dashboard/salidas` | Ventas › Reservas | Comercial › Ventas | seller | `bookings` |
| Tickets | `/dashboard/ventas/tickets` | Ventas › Mostrador | Comercial › Ventas | cashier | — |
| Cotizaciones | `/dashboard/ventas/cotizaciones` | Ventas › Pipeline | Comercial › Ventas | seller | — |
| CRM y leads | `/dashboard/crm` | Ventas › Pipeline | Comercial › Pipeline | seller | `crm` |
| Vendedores | `/dashboard/vendedores` | Ventas › Pipeline | Comercial › Pipeline | manager | — |
| Promociones | `/dashboard/promociones` | Ventas › Demanda | Comercial › Pipeline | manager | — |
| Productos | `/dashboard/productos` | Catálogo › Oferta | Comercial › Catálogo | seller | — |
| Modalidades | `/dashboard/catalogo/modalidades` | Catálogo › Oferta | Comercial › Catálogo | manager | — |
| Categorías | `/dashboard/catalogo/categorias` | Catálogo › Oferta | Comercial › Catálogo | manager | — |
| Precios | `/dashboard/catalogo/precios` | Catálogo › Precios | Comercial › Catálogo | manager | — |
| Costos | `/dashboard/catalogo/costos` | Catálogo › Precios | Comercial › Catálogo | manager | — |
| Políticas | `/dashboard/catalogo/politicas` | Catálogo › Precios | Comercial › Catálogo | manager | — |
| Planes de membresía | `/dashboard/catalogo/membresias` | Catálogo › Membresías | Comercial › Catálogo | manager | — |
| Tour centers | `/dashboard/partners` | Distribución › Red | Comercial › Distribución | manager | — |
| Allotments | `/dashboard/distribucion/allotments` | Distribución › Cupos | Comercial › Distribución | manager | — |
| Reglas de comisión | `/dashboard/distribucion/reglas` | Distribución › Comisiones | Comercial › Distribución | admin | — |
| Comisiones | `/dashboard/comisiones` | Distribución › Comisiones | Comercial › Distribución | manager | `commissions` |
| Liquidaciones | `/dashboard/liquidaciones` | Distribución › Comisiones | Comercial › Distribución | manager | `settlements` |
| Portal B2B ↗ | `/portal` | Distribución › Red | Comercial › Distribución | manager | `b2b_portal` |

### 4.3 Operaciones *(absorbe Mantenimiento)*

| Módulo | Ruta | Antes | Ahora | Rol mínimo | Capacidad |
|---|---|---|---|---|---|
| Despacho | `/dashboard/operaciones/despacho` | Operaciones › Día | Operaciones › Día | operations | `operations` |
| Check-in | `/dashboard/checkin` | **Ventas › Mostrador** | Operaciones › Día | cashier | `bookings` |
| Pickups | `/dashboard/pickups` | Operaciones › Día | Operaciones › Día | operations | `pickups` |
| Rutas | `/dashboard/operaciones/rutas` | Operaciones › Día | Operaciones › Día | operations | `pickups` |
| Transporte | `/dashboard/transporte` | Operaciones › Recursos | Operaciones › Recursos | operations | `transport` |
| Asignación | `/dashboard/operaciones/recursos` | Operaciones › Recursos | Operaciones › Recursos | operations | — |
| Activos | `/dashboard/mantenimiento/activos` | Mantenimiento › Activos | Operaciones › Mantenimiento | operations | — |
| Fuera de servicio | `/dashboard/mantenimiento/fuera-de-servicio` | Mantenimiento › Activos | Operaciones › Mantenimiento | operations | — |
| Órdenes de trabajo | `/dashboard/mantenimiento/ordenes` | Mantenimiento › Trabajo | Operaciones › Mantenimiento | operations | — |
| Preventivos | `/dashboard/mantenimiento/planes` | Mantenimiento › Trabajo | Operaciones › Mantenimiento | manager | — |
| Repuestos | `/dashboard/mantenimiento/repuestos` | Mantenimiento › Repuestos | Operaciones › Mantenimiento | operations | — |

### 4.4 Parque *(solo `park` y `mixed_operator`)*

| Módulo | Ruta | Antes | Ahora | Rol mínimo |
|---|---|---|---|---|
| Centro de control | `/dashboard/parque/control` | Parque › Control | Parque › Operación | operations |
| Atracciones | `/dashboard/parque/atracciones` | Parque › Control | Parque › Operación | operations |
| Zonas y aforo | `/dashboard/parque/zonas` | Parque › Aforo | Parque › Operación | operations |
| Accesos | `/dashboard/parque/accesos` | Parque › Aforo | Parque › Operación | cashier |
| Bitácora | `/dashboard/parque/bitacora` | Parque › Control | Parque › Operación | operations |
| Incidentes | `/dashboard/parque/incidentes` | Parque › Seguridad | Parque › Seguridad | operations |
| Acciones correctivas | `/dashboard/parque/acciones` | Parque › Seguridad | Parque › Seguridad | operations |
| Waivers | `/dashboard/parque/waivers` | Parque › Seguridad | Parque › Seguridad | cashier |
| Plantillas de waiver | `/dashboard/parque/waivers-plantillas` | Parque › Seguridad | Parque › Seguridad | manager |
| Inspecciones | `/dashboard/parque/inspecciones` | Parque › Seguridad | Parque › Seguridad | operations |
| Checklists | `/dashboard/parque/checklists` | Parque › Seguridad | Parque › Seguridad | manager |

### 4.5 Comercio · Clientes · Equipo · Analítica

| Módulo | Ruta | Antes | Ahora | Rol mínimo |
|---|---|---|---|---|
| Artículos | `/dashboard/comercio/articulos` | Comercio › Inventario | Comercio › Inventario | operations |
| Existencias | `/dashboard/comercio/existencias` | Comercio › Inventario | Comercio › Inventario | operations |
| Movimientos | `/dashboard/comercio/movimientos` | Comercio › Inventario | Comercio › Inventario | operations |
| Almacenes | `/dashboard/comercio/almacenes` | Comercio › Inventario | Comercio › Inventario | manager |
| Órdenes de compra | `/dashboard/comercio/compras` | Comercio › Compras | Comercio › Compras | manager |
| Proveedores | `/dashboard/proveedores` | Comercio › Compras | Comercio › Compras | manager |
| Directorio | `/dashboard/clientes/directorio` | Clientes › Base | Clientes › Base | seller |
| Membresías | `/dashboard/clientes/membresias` | Clientes › Base | Clientes › Fidelización | cashier |
| Gift cards | `/dashboard/clientes/gift-cards` | Clientes › Fidelización | Clientes › Fidelización | cashier |
| Vouchers | `/dashboard/clientes/vouchers` | Clientes › Fidelización | Clientes › Fidelización | cashier |
| Casos y reclamos | `/dashboard/clientes/casos` | Clientes › Experiencia | Clientes › Experiencia | seller |
| Personal | `/dashboard/personal` | **Operaciones + Equipo** | Equipo › Personal | manager |
| Certificaciones | `/dashboard/equipo/certificaciones` | Equipo › Personal | Equipo › Personal | manager |
| Turnos | `/dashboard/equipo/turnos` | Equipo › Planificación | Equipo › Organización | manager |
| Asistencia | `/dashboard/equipo/asistencia` | Equipo › Planificación | Equipo › Organización | operations |
| Documentos y SOP | `/dashboard/equipo/documentos` | Equipo › Conocimiento | Equipo › Conocimiento | manager |
| Acuses | `/dashboard/equipo/acuses` | Equipo › Conocimiento | Equipo › Conocimiento | manager |
| Rentabilidad | `/dashboard/rentabilidad` | Analítica › Rentabilidad | Analítica › Rentabilidad | manager |
| Reportes | `/dashboard/analitica/reportes` | Analítica › Reportes | Analítica › Reportes | manager |

### 4.6 Finanzas y Administración

| Módulo | Ruta | Antes | Ahora | Rol mínimo | Capacidad |
|---|---|---|---|---|---|
| Caja y turnos | `/dashboard/caja` | Finanzas › Tesorería | Finanzas › Caja | cashier | `cash_pos` |
| Cajas registradoras | `/dashboard/finanzas/cajas` | Finanzas › Tesorería | Finanzas › Caja | manager | — |
| Pagos | `/dashboard/pagos` | Finanzas › Tesorería | Finanzas › Tesorería | cashier | `payments` |
| Tipos de cambio | `/dashboard/finanzas/divisas` | Finanzas › Contabilidad | Finanzas › Tesorería | manager | — |
| Cuentas por cobrar | `/dashboard/cobros` | Finanzas › Ciclo | Finanzas › Cuentas | manager | `accounting` |
| Cuentas por pagar | `/dashboard/deudas` | Finanzas › Ciclo | Finanzas › Cuentas | manager | `accounting` |
| Gastos | `/dashboard/gastos` | Finanzas › Ciclo | Finanzas › Cuentas | manager | `accounting` |
| Facturación | `/dashboard/finanzas/facturas` | Finanzas › Ciclo | Finanzas › Facturación | manager | — |
| Perfiles fiscales | `/dashboard/finanzas/fiscal` | Finanzas › Contabilidad | Finanzas › Facturación | admin | — |
| Plan de cuentas | `/dashboard/finanzas/cuentas` | Finanzas › Contabilidad | Finanzas › Contabilidad | admin | — |
| Libro diario | `/dashboard/finanzas/diario` | Finanzas › Contabilidad | Finanzas › Contabilidad | admin | — |
| Configuración | `/dashboard/configuracion` | Admin › Configuración | Admin › Organización | admin | — |
| Sucursales | `/dashboard/administracion/sucursales` | Admin › Configuración | Admin › Organización | manager | — |
| Hoteles | `/dashboard/administracion/hoteles` | Admin › Configuración | Admin › Organización | operations | — |
| Aprobaciones | `/dashboard/administracion/aprobaciones` | Admin › Gobierno | Admin › Gobierno | manager | — |
| Auditoría | `/dashboard/auditoria` | Admin › Gobierno | Admin › Gobierno | admin | `audit` |
| Integraciones | `/dashboard/administracion/integraciones` | Admin › Plataforma | Admin › Plataforma | admin | — |

---

## 5. Conflictos detectados y cómo se resolvieron

| Conflicto | Decisión | Motivo |
|---|---|---|
| `/dashboard/personal` aparecía en **Operaciones › Personal en campo** y en **Equipo › Personal** | Origen canónico: **Equipo › Personal**. Se elimina de Operaciones. | Regla §26: un solo origen por módulo. La ficha del empleado es administración de personas. |
| `/dashboard/checkin` estaba en **Ventas** | Movido a **Operaciones › Día de operación** | Job-to-be-done: validar el acceso el día de la experiencia, no vender. Sigue visible para `cashier`. |
| `/dashboard/salidas` (cupos) podía ir a Operaciones | Se queda en **Comercial › Ventas** | La pregunta que responde es «¿qué puedo vender y cuánto cupo queda?». El día de operación se ve en Despacho, que es otra ruta. |
| Mantenimiento gestiona **atracciones y vehículos** | Grupo dentro de **Operaciones**, no de Parque | §4 del brief: si administra vehículos de excursión pertenece a Operaciones. Así un tour center sin parque conserva el mantenimiento de su flota. |
| `/dashboard/crm` (leads) vs Clientes | Canónico en **Comercial › Pipeline** | `crm` administra oportunidades; `clientes/directorio` administra la ficha del visitante. Entidades distintas. |
| Comisiones podía duplicarse en Finanzas | Canónico en **Comercial › Distribución** | Finanzas enlaza por contexto, no duplica la página. |
| Divisas estaba en Contabilidad | Movido a **Tesorería** | Lo consulta tesorería a diario; contabilidad queda solo con plan de cuentas y diario. |

---

## 6. Adaptación por rol

Ranking existente (`ROLE_RANK`): `superadmin 100 · owner 90 · admin 80 · manager 60 · operations 40 · cashier 40 · seller 20 · partner 10`.

| Rol | Workspaces visibles |
|---|---|
| owner / admin | los 10 |
| manager | los 10 salvo lo restringido a `admin` dentro de cada uno |
| operations | Inicio · Operaciones · Parque · Comercio · Clientes |
| cashier | Inicio · Comercial · Operaciones · Clientes · Finanzas |
| seller | Inicio · Comercial · Clientes |
| partner | no entra al panel interno; va a `/portal` |

La visibilidad se calcula por ítem: un workspace desaparece del nivel 1 cuando
**ningún** módulo suyo es visible para ese usuario. Nunca se muestra una opción
que al abrirse responda «no tienes permisos».

## 7. Adaptación por tipo de empresa

| Tipo | Parque | Comercio | Resto |
|---|---|---|---|
| `park` | sí | sí | sí |
| `mixed_operator` | sí | sí | sí |
| `excursion_company` · `tour_operator` · `tour_center` · `agency` · `transport` | **no** | sí | sí |

Un tour center no ve Atracciones, Aforo, Waivers de atracción ni Inspecciones de
parque, pero conserva Mantenimiento (flota) dentro de Operaciones.

Además, cada módulo puede exigir una capacidad del plan (`modules_enabled`):
`bookings`, `crm`, `commissions`, `settlements`, `payments`, `cash_pos`,
`transport`, `pickups`, `operations`, `b2b_portal`, `accounting`, `reports`, `audit`.

---

## 8. Compatibilidad de URLs

**Ninguna ruta de módulo cambió.** Solo cambia a qué workspace pertenece, y eso
se resuelve por coincidencia de prefijo más largo en `workspaceOf(pathname)`.

Los cuatro *hubs* de los dominios fusionados sí dejaron de existir como página
propia y redirigen con `redirect()` del lado del servidor (308, deep link intacto):

| Ruta antigua | Redirige a |
|---|---|
| `/dashboard/ventas` | `/dashboard/comercial` |
| `/dashboard/catalogo` | `/dashboard/comercial` |
| `/dashboard/distribucion` | `/dashboard/comercial` |
| `/dashboard/mantenimiento` | `/dashboard/operaciones` |

Sus rutas hijas (`/dashboard/ventas/tickets`, `/dashboard/catalogo/precios`,
`/dashboard/mantenimiento/activos`, …) **no** se tocaron.

---

## 9. Seguridad

La visibilidad del menú **no** sustituye la autorización. Se mantienen las tres capas:

1. **UI** — `src/lib/nav.ts` decide qué se dibuja.
2. **Ruta** — `src/middleware.ts` protege todo lo que no esté en `publicRoutes`.
3. **Servidor** — `requireTenant()`, `requireAtLeast()` y `tenantQuery()` aplican
   empresa y rol en la base de datos, en cada endpoint.

Ocultar «Finanzas» no protege `/dashboard/finanzas`: lo protege el servidor.

---

## 10. Contexto organizacional

La cabecera del panel contextual muestra siempre **empresa actual + tipo de
empresa**, y un selector de **sucursal activa** cuando la empresa tiene más de
una. La selección se conserva al cambiar de workspace y entre recargas.

> Estado actual: la sucursal activa es contexto de interfaz (se conserva y se
> muestra). El modelo de datos todavía no vincula usuario ↔ sucursal, así que
> las consultas aún no se filtran por ella. Ese enganche es el siguiente paso.

---

## 11. Comportamiento del shell

| Estado | Nivel 1 (riel) | Nivel 2 (panel contextual) |
|---|---|---|
| Expandido | icono + nombre | panel fijo de 252 px con los grupos del workspace activo |
| Contraído | sólo iconos + tooltip | aparece al posarse sobre el icono, en un flyout de 252 px |
| Móvil | drawer, paso 1 | drawer, paso 2 (tras elegir workspace) |

- La preferencia expandido/contraído se guarda en `localStorage` (`tf:nav-mode`).
- En contraído el clic **navega** al workspace y el *hover* muestra su árbol: nunca compiten por el mismo gesto y contraer no cuesta perder el nivel 2.
- Entrar a un workspace **reemplaza** el nivel 2; no hay acordeones anidados.
- Migas de pan de 3 niveles como máximo: `Workspace / Grupo / Módulo` (el grupo no es enlazable porque no es una página).
- Pie del riel: Administración, Perfil y el conmutador de ancho. Pie del panel: Ayuda y búsqueda ⌘K.
- Acciones rápidas (POS, reserva, check-in, caja) viven en el botón **Crear** de la cabecera y en la paleta ⌘K, nunca como módulos permanentes.
- Recientes (máx. 5, `tf:recent-modules`) se muestran **sólo dentro de ⌘K**, no como lista permanente en el sidebar. No se implementaron favoritos manuales en esta fase por no añadir complejidad sin demanda real.
- Los contadores (tareas, aprobaciones, incidencias) sólo se pintan cuando hay algo que hacer.

## 12. Reglas para añadir un módulo nuevo

1. Se declara **solo** en `src/lib/nav.ts`, dentro de un grupo existente.
2. Nombre corto (una o dos palabras). El detalle va en `description`.
3. Rol mínimo (`minRole`), capacidad (`module`) y tipos de empresa
   (`companyTypes`) explícitos; sin `if (company.type === …)` en componentes.
4. Un solo origen canónico. Si otro dominio lo necesita, enlaza — no duplica.
5. Si el nivel 1 llegara a 11 workspaces, primero se revisa si alguno debe
   fusionarse. El techo son ~10.
