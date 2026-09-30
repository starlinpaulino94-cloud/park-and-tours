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
> trece reales queda **once** por cerrar.

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

Quedan **once** — que son los once de `SIN_PUERTA_CONOCIDAS`: trece reales menos
esta y menos la bitácora del parque, con la que empezó todo.

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
