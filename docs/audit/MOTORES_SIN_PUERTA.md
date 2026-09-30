# Motores sin puerta

> Rutas de la API implementadas **enteras** a las que **no se llega desde el
> producto**. Ninguna línea de la aplicación las llama.
>
> Medido el 30-sep-2026 sobre las 176 rutas del repositorio. La lista la
> mantiene al día una guarda de `ui-contracts.test.ts`, que falla en las dos
> direcciones: una ruta nueva sin puerta la pone en rojo, y una que ya tenga
> puerta obliga a sacarla de aquí.

## De dónde salió esto

La bitácora de atracciones aparecía vacía y el diagnóstico fácil era «le falta
el botón de crear». No era eso: **le faltaba quien la escribiera**.
`POST /api/attractions/status` estaba implementado entero —cambia el estado,
añade la entrada inmutable, acumula el downtime, deja rastro en auditoría— y no
lo llamaba ni una línea.

Al barrer las 176 rutas buscando el mismo patrón aparecieron **quince más**.

No es un descuido suelto: es una forma de construir —terminar el motor y dejar
la pantalla para «la siguiente iteración»— que produce módulos que **parecen
hechos y no se pueden usar**. Y la iteración siguiente no llega, porque desde
fuera el módulo se ve entero.

## Lo que NO es un hueco

Veintidós rutas no tienen llamador **en este repositorio** y está bien así,
porque lo tienen fuera:

| familia | quién la llama |
| --- | --- |
| `/api/cron/` (7) | el planificador; las siete están declaradas en `vercel.json` |
| `/api/octo/v1/` (10) | el revendedor, por el estándar OCTO |
| `/api/v1/` (3) | la API pública del socio |
| `/api/stripe/webhook` | Stripe |
| `/api/health` | la sonda de disponibilidad |

## Los quince, por lo que cuesta tenerlos cerrados

### 1. El activo que se cae y no arrastra nada — `/api/assets/[id]/status`

**El más caro, y es el mismo caso que la bitácora con más consecuencias.**
`asset-impact.ts` es un motor completo: baja el activo, arrastra a
`maintenance` la atracción que depende de él, escribe su entrada de bitácora y
**crea una tarea por cada salida afectada para que nadie se olvide de llamar a
los clientes**.

Cerrado, todo eso no ocurre nunca. La avería se apunta a mano en algún sitio, la
atracción sigue figurando abierta y **los clientes de las salidas afectadas no
reciben aviso** porque la tarea no existe.

### 2. El saldo regalo que se emite y no se puede usar — `redeem`, `refund`, `void`

`/api/gift-cards/[id]/redeem`, `/api/gift-cards/[id]/refund`,
`/api/gift-cards/[id]/void`.

La pantalla **emite** (`POST /api/gift-cards`, que sí está enchufado), y las tres
acciones del ciclo de vida están huérfanas. Una tarjeta vendida **no se puede
canjear, ni devolver, ni anular** desde el producto.

Detalle que lo subraya: las tres tienen su etiqueta de auditoría
(`gift_card_redeemed`, `_refunded`, `_voided`), añadidas en esta misma
auditoría. Están **auditadas y no se pueden ejecutar**.

### 3. Contabilidad: tres puertas de seis — `chart`, `post`, `trial-balance`

`/api/ledger/chart`, `/api/ledger/post`, `/api/ledger/trial-balance`.

Aquí **sí hay casa**: `finanzas/estados` y `reportes/estados-financieros` llaman
a `periods`, `statements` y `close-year`. Lo que falta son justo las tres cosas
que pide un contador:

- **el plan de cuentas** (`chart`), que no se puede ni mirar;
- **el asiento manual** (`post`), así que un ajuste hay que meterlo por SQL;
- **el balance de comprobación** (`trial-balance`), que es el papel con el que
  se cuadra antes de cerrar.

### 4. Almacén sin movimientos — `/api/inventory/movement`, `/api/inventory/low-stock`

`comercio/almacenes` es un CRUD de almacenes. No hay forma de **mover stock** ni
de ver el **aviso de mínimos**. Un almacén en el que no entra ni sale nada es una
ficha, no un almacén.

### 5. El cliente que no se puede vetar — `/api/customers/[id]/lista-negra`

Implementado y sin botón en ninguna pantalla. El caso de uso es real y
desagradable: alguien a quien no se le quiere volver a vender.

### 6. El resto

| ruta | qué queda sin hacerse |
| --- | --- |
| `/api/proveedor/enlace` | el enlace de un solo uso de la fase 8.4, para que el proveedor conteste sin cuenta |
| `/api/maintenance/reconcile-drafts` | la conciliación de borradores a mano; su gemela de `cron` sí corre sola |
| `/api/storage/upload` | subir ficheros: sin esto, todo campo de imagen se queda pidiendo una URL |
| `/api/setup/demo` | cargar los datos de demostración desde el producto |
| `/api/stripe/customer-portal` | el portal de facturación de Stripe, para que el cliente gestione su suscripción |

## Cómo se cierra uno

El patrón está resuelto una vez, en el centro de control del parque, y sirve de
plantilla: un `rowActions` en la pantalla que abre un diálogo, llama a la ruta y
refresca; y **quitar de `writable` los campos que la ruta deriva**, para que no
quede una segunda puerta que escriba lo mismo sin dejar rastro. Ver la entrada
«La bitácora del parque estaba vacía» en `FIX_LOG.md`.
