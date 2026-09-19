# El camino del dinero

Las reglas que una venta y su cancelación tienen que cumplir siempre, dónde
viven, y qué pasó cuando alguna no se cumplía.

---

## 1. Por qué existe este documento

`createOrderWithBookings` son casi ochocientas líneas que convierten una venta
en reservas, participantes, vouchers, recogidas, comisiones y cuentas por
cobrar. `cancelBookingFully` son trece cosas que hay que deshacer. Hasta la ola
10, **ninguna de las dos tenía una sola prueba**.

Escribir esas pruebas destapó cuatro defectos que llevaban tiempo en
producción. Ninguno daba error: los cuatro producían números equivocados en
silencio. Están en `docs/audit/FIX_LOG.md` como AUD-M01 a M04.

---

## 2. Los invariantes de una venta

Estos no son detalles de implementación: son lo que cualquiera da por hecho al
mirar un listado de ventas.

| Invariante | Dónde se prueba |
|---|---|
| El total de la orden es la suma de sus reservas | `booking-service.test.ts` |
| `subtotal − descuento + impuesto = total`, en la orden y en cada reserva | idem |
| Una reserva nace debiendo su total entero | idem |
| El margen excluye el impuesto, que no es ingreso | idem |
| Dos líneas de la misma salida se suman para el cupo | idem (AUD-B01) |
| La tasa de cambio sale de la base, nunca del cliente | idem (AUD-F30) |
| Una orden no mezcla monedas | idem (AUD-F03) |
| Una venta que falla a medias no deja reservas vivas ni plazas ocupadas | idem (AUD-F34) |

### El impuesto, el descuento y los extras

- El impuesto se aplica **también** sobre los extras. Sumarlos después del
  impuesto los dejaba exentos: en un grupo de 40 con almuerzo de 35 son 1.400 de
  base sin ITBIS, que es un error de declaración.
- El descuento del tour **no** rebaja el extra. Un 10 % pactado sobre la
  excursión no rebaja la langosta que el cliente añadió aparte.
- Un extra que el catálogo no reconoce **tumba la venta**. Cobrar de menos en
  silencio es peor que fallar.

### La comisión y el costo no usan la misma base

Y es a propósito:

| | ¿Incluye los extras? | Por qué |
|---|---|---|
| **Costo** (`resolveCost`) | **No** | El almuerzo tiene su propio proveedor. Meterlo en la base de una tarifa por porcentaje le pagaría dos veces al del tour. |
| **Comisión** | **Sí** | El vendedor vendió el almuerzo, y lo que cobra sale de un ingreso que existe. |

La base de la comisión es la **venta neta**: bruto menos descuento, sin
impuesto. Comisionar sobre el total con impuesto le pagaría al vendedor un
porcentaje del ITBIS, que es dinero del Estado que pasa por la caja.

---

## 3. La regla que gobierna las cancelaciones

> **Una reserva muerta vale lo que el cliente pagó y no se le devolvió.**

Con esa frase los cuatro casos cuadran, y **ninguno deja saldo**:

| Caso | Pagó | Se le devolvió | Vale | Saldo de la orden |
|---|---|---|---|---|
| Sin pagar y cancelada | 0 | 0 | 0 | 0 |
| Sin derecho a reembolso | 200 | 0 | 200 | 0 |
| Reembolso parcial | 200 | 100 | 100 | 0 |
| Reembolso total | 200 | 200 | 0 | 0 |

Y lo retenido por una cancelada **no se reparte** entre las reservas vivas de la
misma orden: ese dinero ya tiene dueño. Repartirlo daba por pagada a medias una
reserva viva con el dinero de otra que se cayó, y el cliente dejaba de recibir
el aviso de que todavía debía.

Es la misma regla que ya aplicaban `netBookingAmount` (el panel) y la vista de
la migración 0023. `syncOrderTotals` era el que no la seguía.

---

## 4. Los estados terminales de una reserva

`cancelled`, `refunded`, `partially_refunded`. Viven **en un solo sitio**,
`src/lib/types.ts`:

```ts
BOOKING_TERMINAL_STATES
isTerminalBookingStatus(status)
```

### Por qué importa tanto

Estaban escritos quince veces por el código, y a la mitad le faltaba
`partially_refunded` — que es el estado de una **cancelación con penalización**,
o sea la más normal de todas. Una reserva en ese estado seguía contando como
viva en la factura fiscal, en el manifiesto del guía, en la lista de embarque,
en la liquidación del vendedor y en los informes de rentabilidad.

Hay una guarda en `ui-contracts.test.ts` que impide volver a escribirla a mano.
Las únicas excepciones son listas de estados de **orden** —otro enum, que no
tiene `partially_refunded`— y van apuntadas con su motivo, con una segunda
guarda que comprueba que el motivo es cierto.

### Cancelar dos veces

`cancelBookingFully` se protege a sí misma. La comprobación vivía en cada
llamador, y el módulo existe precisamente para que quien llame no tenga que
acordarse de nada. Comprobado antes de arreglarlo: la segunda cancelación
pasaba y **salía un segundo pago de reembolso por el importe completo**.

---

## 5. El cupo del socio

Lo que la reserva guarda —de qué contrato salieron sus plazas— es lo que se usa
para devolverlas al cancelar. Se guarda **cuando se resuelve**, no se
reconstruye después adivinando.

El respaldo legítimo sigue existiendo: un contrato sin producto es «te garantizo
10 plazas en lo que sea» y aplica a todo. Lo que ya no pasa es que ese respaldo
atrape a un producto que sencillamente no tiene cupo.

---

## 6. Cómo se prueba todo esto

`src/test/fake-tenant.ts` es una base con memoria que falsea **solo el suelo**:
`tenantQuery`, `tenantCreate`, `tenantUpdate`.

Es la decisión que hace que las pruebas sirvan. Falsear los colaboradores
—precio, cupo, capacidad, comisiones— habría comprobado que el servicio llama a
lo que hay que llamar, que es lo que ya se ve leyendo el código. Falseando el
suelo, todo eso corre **de verdad** contra filas reales, y la prueba afirma lo
único que le importa a la empresa: qué acaba escrito y si cuadra.

**Lo que no es:** no hay RLS, ni restricciones `check`, ni claves foráneas, ni
disparadores, ni transacciones. Una prueba que pase ahí no demuestra que la base
aceptaría la fila; para eso están `supabase/tests/*.test.sql` y
`scripts/db-test.sh`.

---

## 7. Lo que sigue sin cubrir

Honestidad sobre el alcance: la ola 10 cubrió la creación y la cancelación de
una venta. Siguen sin pruebas de servicio, entre otros:

- `octo-service.ts` (1.051 líneas) — el conector de OTAs.
- `membego-*-service.ts` — el canje de beneficios.
- `invoice-service.ts` — la emisión fiscal, que sí recibió un arreglo en la
  ola 10 pero no pruebas propias.
- 92 de las 146 rutas de API no aparecen en ninguna prueba (eran 93 antes de esta ola).
