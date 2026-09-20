# El canal de las OTAs

Por aquí entran las reservas de GetYourGuide, Viator, Civitatis y de cualquier
revendedor que hable **OCTO** (*Open Connectivity for Tourism Operators*). Es la
misma puerta para todos: el estándar existe justamente para no tener un conector
por OTA.

Este documento cuenta qué le pasa a una plaza desde que un revendedor la retiene
hasta que la guagua sale, y por qué el conector está escrito como está.

---

## La regla que ordena todo esto

> Una reserva que entra por una OTA pasa por **el mismo camino** que una del
> mostrador: `createOrderWithBookings` para crearla y `cancelBookingFully` para
> cancelarla. No hay un camino corto «porque es API».

La tentación es real: escribir la fila de `booking` a mano son diez líneas. El
precio de caer en ella es que esa reserva **no** comprobaría el cupo de la
salida, **no** consumiría el cupo contratado del socio, **no** devengaría la
comisión, **no** apartaría los almuerzos del almacén, **no** generaría el
voucher y **no** aparecería en el manifiesto. Media operación funcionando a
medias, y descubriéndose en el punto de encuentro.

---

## Las cuatro fases de una plaza

```
  RESERVAR ───► ON_HOLD ───► CONFIRMAR ───► CONFIRMED ───► (viaje) ─► REDEEMED
                   │                            │
                   │ el plazo pasa              │ el revendedor cancela
                   ▼                            ▼
                EXPIRED                      CANCELLED
```

### 1. Reservar: retener sin cobrar

El revendedor manda un `uuid` suyo y dice cuántos minutos quiere la plaza
apartada. Lo que ocurre, en orden:

1. **Se barren las retenciones vencidas** de la empresa. El cupo que se va a
   comprobar tiene que ser el real, no el que retiene un carrito muerto.
2. **Se busca ese `uuid`.** Si ya existe, se devuelve la MISMA reserva. Un
   revendedor reintenta siempre —se le cae la conexión, su cola lo reencola— y
   sin esto cada reintento apartaría otras plazas para el mismo pasajero.
3. Se comprueba producto, opción y **fecha**. Un producto que se vende por
   fecha exige `availabilityId`: reservar «para cualquier día» dejaría una
   reserva sin cupo comprobado y sin manifiesto.
4. Se crea la venta por el camino normal.
5. Se le pone el **plazo** (`hold_until`) y las marcas del revendedor.

El plazo que pide la OTA manda sobre el de mostrador —30 minutos de una OTA no
son las 24 horas de una transferencia bancaria—, con el techo que fije la
operadora en `octo_max_hold_minutes`.

> **Si algo falla después del paso 4, la venta se deshace.** La plaza ya está
> apartada y la venta ya existe: contestar error y dejarla ahí sería apartar un
> asiento para una reserva que el revendedor nunca verá. Se compensa con la
> misma acción que usa la saga del mostrador.

### 2. Confirmar: la retención se convierte en venta

Primero se **para el plazo**, después se marca la reserva como confirmada. El
orden no es casual: al revés, un fallo a mitad dejaría una reserva confirmada
bajo una venta con la retención corriendo, y el barrido de vencidas la
cancelaría sola. Una venta cerrada que se cae sin que nadie lo pida es el peor
final posible.

Confirmar dos veces contesta lo mismo, y además **repara**: si la venta sigue
con plazo, lo para.

La venta queda en `pending_payment`, y es la verdad: está vendida y sin cobrar
porque el revendedor **liquida a fin de mes**. La reserva, en cambio, queda
`confirmed` — y ese estado no lo pisa el prorrateo del cobro, porque los cuadros
de mando cuentan `confirmed` como venta y `pending_payment` no.

### 3. Prorrogar

Existe porque el cliente del revendedor está pagando con tarjeta y el cobro
tarda. Sin prórroga, la alternativa es cancelar y volver a reservar, que suelta
la plaza en medio y puede perderla.

### 4. Cancelar

Pasa por `cancelBookingFully`, igual que en el mostrador: suelta la plaza, anula
la comisión, devuelve el cupo del socio, cancela el devengo del proveedor, libera
las existencias apartadas, invalida el voucher, avisa — y ofrece la plaza a la
**lista de espera**.

---

## EXPIRED no es CANCELLED

Es la distinción que más dinero mueve de todo el conector.

* **EXPIRED** — el revendedor no pagó a tiempo. Es suyo. No hay nada que
  atender.
* **CANCELLED** — la reserva se canceló. Para la OTA es una incidencia: hay un
  cliente al que avisar y un reembolso que decidir.

Por eso el barrido **primero marca y después suelta**. Si se cancelara primero,
la reserva quedaría en un estado terminal y el revendedor leería CANCELLED donde
le tocaba EXPIRED. Y si la marca no se puede escribir, **no se suelta la plaza**:
se espera al barrido siguiente. Llegar tarde es mucho más barato que mentir.

### Dónde corre el barrido

No en un cron propio. Se intentó y **no despliega**: el plan Hobby de Vercel solo
admite trabajos diarios.

La lección no fue «hace falta el plan Pro». Lo que de verdad sostiene esto es que
el barrido corre **al consultar disponibilidad y al reservar** — y esa es la
cobertura que importa, porque una plaza bloqueada de más solo hace daño cuando
alguien intenta comprarla, y ese intento es exactamente lo que dispara el
barrido. Un cron horario habría sido una red para el caso en que nadie pregunta,
que es el caso en que la plaza bloqueada no le quita la venta a nadie.

El repaso diario sigue existiendo dentro del cron de cobros, para que los
contadores de la salida estén al día en las pantallas de la operadora.

---

## Lo que este conector no se permite

### Tragarse un error de la base

`supabaseService()` **no lanza** cuando Postgres dice que no: devuelve el error
dentro del resultado. Así que esto compila, pasa la revisión y no hace nada:

```ts
await sb.from("sales_order").update({ hold_until }).eq("id", id);
```

Y `hold_until` se queda nulo. El barrido filtra por `hold_until < ahora`, que un
nulo **no cumple jamás** — ni en Postgres ni en PostgREST. La plaza queda
retenida para siempre, el revendedor recibe una reserva de aspecto correcto, y
la excursión sale con asientos vacíos que el sistema daba por vendidos.

Toda lectura y toda escritura que decida plazas o dinero comprueba su error
(`mustRead` / `mustWrite`). Las dos excepciones —las marcas de `octo_status:
CANCELLED`— llevan el motivo escrito donde viven: la cancelación ya ocurrió y el
estado se deduce del estado interno, así que fallar sería inventarle un problema
a quien solo pidió cancelar.

Hay una guarda que lo vigila: `ui-contracts.test.ts`, «la base dice que no y
alguien tiene que oírlo».

### Dejar que un revendedor lea lo del vecino

Cada consulta por `uuid` filtra también **por socio**. Sin ese filtro bastaría
con adivinar un uuid para leer el nombre y el teléfono del cliente de la
competencia. El conector usa la llave de servicio, que se salta la RLS: aquí el
aislamiento lo pone el código a mano, consulta por consulta, y hay pruebas que lo
comprueban.

### Contar las reservas de prueba como negocio

Una certificación con la OTA deja reservas `octo_test_mode`. El panel las
descarta: si no, la operadora vería ventas que nunca existieron.

---

## Dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| Las reglas del estándar (puras, sin base) | `src/lib/octo.ts` |
| El conector contra la base | `src/lib/octo-service.ts` |
| Las pruebas del ciclo completo | `src/lib/octo-service.test.ts` |
| El doble de PostgREST para probarlo | `src/test/fake-supabase.ts` |
| Los dos verbos para escribir sin fe | `src/lib/supabase/write.ts` |
| El panel de la operadora | `/dashboard/distribucion/canales` |
