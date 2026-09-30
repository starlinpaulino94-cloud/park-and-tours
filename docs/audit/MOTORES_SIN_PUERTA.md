# Motores sin puerta

> Rutas de la API implementadas **enteras** a las que **no se llega desde el
> producto**. Ninguna línea de la aplicación las llama.
>
> Medido el 30-sep-2026 sobre las 176 rutas del repositorio. La lista la
> mantiene al día una guarda de `ui-contracts.test.ts`, que falla en las dos
> direcciones: una ruta nueva sin puerta la pone en rojo, y una que ya tenga
> puerta obliga a sacarla de aquí.
>
> **Corregido el 30-sep:** el primer barrido dijo dieciséis y eran **trece**. Tres
> de las que acusó tenían puerta desde el día que se escribieron; fallaba el
> detector, no el producto. Ver «Tres huecos que no existían», más abajo. De las
> trece reales quedan **cinco** por cerrar.

## De dónde salió esto

La bitácora de atracciones aparecía vacía y el diagnóstico fácil era «le falta
el botón de crear». No era eso: **le faltaba quien la escribiera**.
`POST /api/attractions/status` estaba implementado entero —cambia el estado,
añade la entrada inmutable, acumula el downtime, deja rastro en auditoría— y no
lo llamaba ni una línea.

Al barrer las 176 rutas buscando el mismo patrón aparecieron **doce más**.

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

## Los trece, por lo que cuesta tenerlos cerrados

### ~~1. El activo que se cae y no arrastra nada~~ — **CERRADO el 30-sep**

Era el más caro. `asset-impact.ts` baja el activo, recalcula el cupo de las
salidas futuras, cierra las que ya no se pueden servir, arrastra a
`maintenance` la atracción que depende de él y **crea una tarea por cada salida
afectada para que alguien llame a los clientes**. Nada de eso ocurría.

Ya tiene puerta, con **previsualización del impacto antes de confirmar**: qué
salidas se cierran y **qué reservas quedan fuera, con su número y su cliente**.
Ver la entrada «El activo que se caía y no arrastraba nada» en `FIX_LOG.md`.

Quedan **cinco** — los de `SIN_PUERTA_CONOCIDAS`: trece reales menos esta, menos
la bitácora del parque con la que empezó todo, menos las tres de contabilidad,
menos las dos de almacén y menos la lista negra.

### ~~2. El saldo regalo que se emite y no se puede usar~~ — **NUNCA FUE UN HUECO**

Decía que `.../redeem`, `.../refund` y `.../void` estaban huérfanas y que una
tarjeta vendida no se podía canjear, ni devolver, ni anular desde el producto.

**Era falso.** Las tres tienen puerta desde el commit que las escribió:
`gift-card-drawer.tsx` abre el detalle de la tarjeta al pulsar su fila, con los
tres botones —Consumir, Devolver, Anular—, el motivo obligatorio donde toca, el
aviso de cuánto saldo se extingue al anular, y el libro de movimientos debajo.
Incluso había ya una prueba que afirmaba que el cajón las llama.

Lo que falló fue **el detector**. Buscaba la url escrita entera y admitía
variable solo en el segmento dinámico (`/api/x/${id}/y`). El cajón interpola
también el segmento de la **acción**:

```ts
type Action = "redeem" | "refund" | "void";
await api.post(`/api/gift-cards/${card._id}/${action}`, payload);
```

Ninguna de las tres urls aparece escrita en ningún sitio, así que el barrido las
dio por huérfanas y este documento lo repitió, porque lo copiaba del barrido.

Arreglado: ahora **cualquier** segmento puede venir interpolado, pero solo cuenta
si el mismo fichero nombra ese literal entre comillas — sin esa condición
`/api/${a}/${b}` valdría de llamador de cualquier cosa y la guarda dejaría de
morder. Lo fija la prueba «una url construida por partes cuenta como puerta, y
una vacía no», medida contra fuentes sintéticas para que siga midiendo el
detector cuando el repositorio cambie.

**Coste de la equivocación:** un inventario que inventa huecos manda a arreglar
lo que ya está hecho y le quita crédito a los huecos de verdad. Fue el único
falso positivo del barrido —los otros once se verificaron a mano, uno por uno—,
pero contaba por tres.

**Lo que sí le falta al saldo regalo, y no es esto:** `gift_card` no es un método
de cobro. El enum `payment_method` (migración 0003) tiene ocho valores y ninguno
es la tarjeta, y `/api/payments` no la menciona. Consumir saldo y cobrar una
orden son hoy dos gestos sin relación: el cajero consume en el cajón, escribe el
número de orden en la nota a mano, y después cobra la orden por otro método. La
propia ruta lo dice —«la acción NO toca los totales de la orden»— y espera que
«el flujo de cobro lo aplique». Nadie lo aplica. **Eso es un motor que falta, no
uno sin puerta**, y cerrarlo cuesta un valor nuevo en el enum, es decir una
migración que hay que pegar en Supabase.

### ~~3. Contabilidad: tres puertas de seis~~ — **CERRADO el 30-sep**

Las tres tienen puerta. Y de lo que este apartado afirmaba, **una de las tres
frases era falsa y otra a medias** — merece quedar escrito, porque las tres se
escribieron del tirón sin abrir las pantallas:

| lo que decía | lo que era |
| --- | --- |
| «el plan de cuentas, que no se puede ni mirar» | **Falso.** `finanzas/cuentas` lo lista y lo edita desde siempre por el CRUD genérico. Lo que faltaba era el **sembrado** del plan base, que ahora es un botón. Y `ensureChart` ya corría sola antes de cada asiento automático, así que una empresa que vende nunca se quedó sin plan |
| «el asiento manual, así que un ajuste hay que meterlo por SQL» | **Cierto, y era el hueco de verdad.** `ledger_entry` tiene `writable: []` a propósito, así que no había ninguna otra vía. Ahora se registra desde el libro diario, con la partida doble comprobada antes de enviar |
| «el balance de comprobación, el papel con el que se cuadra antes de cerrar» | **A medias.** `statements` ya lo devolvía y `finanzas/estados` lo declaraba en su interfaz… sin pintarlo: el único acceso era el CSV. Ahora se ve en pantalla, y con la prueba —ver abajo— |

Y con la reversa pasaba lo mismo que con las etiquetas de auditoría del saldo
regalo, al revés: el libro diario **se describía a sí mismo** diciendo «un error
no se borra: se corrige con un asiento de reversa», y reversar no se podía. La
ruta acepta `reverseEntry` desde el primer día. Una promesa escrita en la
pantalla que el producto no puede cumplir es peor que no prometer nada.

**El defecto que apareció al enchufarlo:** la ruta del balance de comprobación
tiraba `entries` y `truncated`. El motor los devuelve a propósito —pagina y se
rinde en un techo de 200 000 asientos— y pasado ese techo el informe está
incompleto **y `balanced` sale `true` igual**, porque lo que sí se leyó cuadra
entre ello. Un informe recortado que dice «cuadrado» en el único papel con el que
se cierra un mes. Ahora los dos viajan y la tarjeta antepone el aviso de truncado
a todo lo demás.

Ver la entrada «La contabilidad que no se podía tocar» en `FIX_LOG.md`.

Quedan **cinco**.

### ~~4. Almacén sin movimientos~~ — **CERRADO el 30-sep**, y era el peor de los trece

Este apartado decía «no hay forma de mover stock». **Había una, y eso era el
problema.**

`/dashboard/comercio/movimientos` se titula «Kardex inmutable» y tenía un
formulario genérico **«Nuevo movimiento»** —con cantidad, tipo y almacén
destino— que escribía a `/api/erp/stock_movement`, más lápiz y papelera en cada
fila. La lista blanca de la tabla admitía `quantity`, `movement_type` y hasta
`balance_after`.

Y escribir esa tabla **no mueve el saldo**: nada lo mantiene desde ahí, ni en la
aplicación ni con un disparador en Postgres (comprobado). Así que registrar una
merma de 10 dejaba el kardex diciendo «merma de 10» y la existencia intacta en
50. De paso se saltaba todo lo que vive en `postMovement`:

- el **bloqueo de stock negativo**;
- el recálculo del **costo promedio ponderado** —con el que se valora el
  inventario para cerrar el periodo—;
- la **segunda pata** de una transferencia (una transferencia a medias es el peor
  resultado posible);
- y el **aviso de existencias bajas**.

**Por qué es el peor de los trece:** los otros se notaban, porque el módulo salía
vacío. Este no. La fila **sí aparecía** en la lista, con su insignia y su fecha.
La diferencia entre el libro y la existencia no salía hasta el conteo físico —que
es literalmente lo que avisaba el comentario de `stock_level` en `resources.ts`
desde 0052, una tabla más arriba. 0052 cerró la caché y dejó escribible el libro,
que es peor.

Un motor sin puerta no hace nada. Esto era **una puerta a otra habitación**: hacía
algo, parecía funcionar, y dejaba los datos peor que si no hubiera hecho nada.

Ahora: el movimiento pasa por `POST /api/inventory/movement`, `stock_movement`
está fuera de la lista blanca, no hay lápiz ni papelera, y la lista de reposición
(`low-stock`) se ve en Existencias en vez de solo sonar una vez al mes. Ver «El
kardex que se podía teclear» en `FIX_LOG.md`.

Quedan **cinco**.

### ~~5. El cliente que no se puede vetar~~ — **CERRADO el 30-sep**

El caso limpio del patrón, y el único de los trece al que le faltaba **solo el
botón**. Todo lo demás estaba enchufado y bien: `booking-service` rechaza la venta
a una ficha vetada; la web y la API del socio traducen el rechazo sin decir la
palabra ni el motivo; el CRUD genérico ya rechazaba el cambio de estado desde el
desplegable con `puertaEquivocada`; y el dominio tenía sus **21 pruebas**. Sin ese
botón, la lista negra era exactamente lo que avisa su propio comentario: *una
casilla que no hace nada, y de esas la peor es la que deja a quien la marca
convencido de que hizo algo*.

**Dos cosas que aparecieron al enchufarlo**, ninguna en la ruta:

1. **`blacklist` no estaba en ningún diccionario de etiquetas.** El respaldo de
   `labelOf` la pintaba como la palabra cruda «blacklist» en gris neutro: el
   estado más consecuente que puede tener una ficha, en inglés y del color de
   «inactivo», justo en la insignia que mira el cajero con la persona delante.
2. **El motivo del veto viajaba al socio.** `lista-negra.ts` dice desde su
   cabecera que hacia fuera no viaja ni el motivo ni la palabra, y eso estaba
   aplicado solo a la web y a la API pública. Pero `customer` se expande dentro de
   `order`, `booking` y `lead`: un tour center que leía sus propias órdenes
   recibía la ficha con «no se presentó tres veces» y con el id del empleado que
   lo firmó. Mismo caso que `partner.notes`, ya resuelto en `OCULTO_AL_SOCIO`;
   ahora `blocked_reason` y `blocked_by` están ahí también.

Y el desplegable del formulario dejó de ofrecer «Lista negra»: la ofrecía, y al
guardar saltaba `puertaEquivocada` con su mensaje. La guarda estaba bien; lo que
estaba mal era invitar a un callejón.

Ver «La casilla que por fin hace algo» en `FIX_LOG.md`.

Quedan **cinco**.

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
