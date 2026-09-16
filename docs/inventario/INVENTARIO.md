# Inventario: de la compra al estante y del estante al cliente

Cómo se mueve el almacén, qué lo mueve y qué decisiones quedan en tus manos.

---

## 1. El motor no cambió; cambió quién lo llama

Toda variación de existencias pasa por un único sitio que escribe un
**movimiento** (el libro, inmutable) y después recalcula el **saldo** (la
copia). Eso estaba bien desde el principio. El problema era que solo lo llamaba
la pantalla de movimientos manuales:

| Hecho del negocio | Antes | Ahora |
|---|---|---|
| Recibir una orden de compra | no movía nada | entra al almacén, línea por línea |
| Vender un extra de almacén | no movía nada | aparta existencias |
| Embarcar al cliente | no movía nada | salida real del almacén |
| Cancelar la reserva | no movía nada | devuelve lo apartado |

---

## 2. Comprar → recibir

**Equipo de trabajo**: Comercio → Recibir mercancía.

1. La orden tiene que estar **aprobada, enviada o a medio recibir**. Contra un
   borrador no se recibe: nadie ha aprobado ese gasto.
2. Cada línea dice qué se pidió y a cuánto. Una línea **con artículo** entra al
   almacén; una **sin artículo** (flete, montaje) se recibe pero no mueve
   existencias — es un servicio, no mercancía.
3. Se teclea **lo que llegó en este camión**. Una orden puede recibirse varias
   veces; el sistema lleva la cuenta.
4. Si el proveedor facturó otro precio, se pone: **el costo promedio del
   artículo se recalcula con lo que de verdad se pagó**, no con lo que se pidió.

**Recibir de más se rechaza salvo que lo confirmes.** El proveedor manda 12 en
vez de 10 y eso pasa; lo que no puede pasar es que se cuele sin que nadie lo
vea, porque esas 2 unidades también se pagan.

> **Lo recibido no se teclea.** La columna «recibido» ya no es editable: lo que
> vale es la suma de los movimientos, que es la cifra que tiene detrás unidades
> físicas. Una devolución al proveedor resta, así que la línea vuelve a quedar
> pendiente.

---

## 3. Vender → embarcar

Un extra vendible (Catálogo → Extras) puede declararse **artículo del almacén**:
se le indica el artículo, el almacén y cuántas unidades consume cada uno vendido
(un «almuerzo» es 1; un «pack de 3 cervezas» es 3).

Nace apagado a propósito: una «recogida en el hotel» se vende y no sale de
ningún estante.

Con eso encendido, el ciclo es de tres pasos y no de uno:

```
vender    →  reservado += n      las unidades siguen ahí, ya no son vendibles
embarcar  →  reservado -= n  +  salida real del almacén
cancelar  →  reservado -= n      vuelven a estar libres; nunca salieron
```

Descontar al vender diría que hay menos comida de la que hay. Descontar solo al
embarcar dejaría vender cuarenta almuerzos cuando quedan treinta.

**«Reservado» pasa a significar algo.** La columna existía desde el principio y
siempre decía cero porque nada la escribía.

### Cuando cancelas una reserva ya embarcada

No se devuelven unidades. Esas salieron de verdad y volver a sumarlas sin rastro
descuadraría el almacén: si el cliente devuelve la mercancía, se registra como
**devolución** en movimientos, que deja constancia.

### Vender por encima de lo disponible

**Avisa, no bloquea.** Quien sabe si hay comida para cuatro más es el operador,
no la tabla. El aviso sale en el momento de la venta, que es cuando todavía se
puede llamar al restaurante.

---

## 4. El almacén nunca tumba una venta

Si un extra está mal configurado o la base falla, la reserva del cliente se hace
igual y el fallo queda en el registro del servidor. Lo mismo en el embarque: el
guía está en la playa con cuarenta personas y un problema de inventario no puede
dejarle la lista sin cerrar.

Es una decisión, no un descuido: un ERP que no deja vender porque su módulo de
inventario tiene un artículo sin almacén es un ERP que se desinstala.

---

## 5. El saldo no se edita

La pantalla de existencias es **de solo lectura**, y el saldo tampoco se puede
escribir por la API genérica. Corregir una diferencia se hace con un
**movimiento de ajuste** o un **conteo**, que dejan constancia de quién y por
qué. Un saldo editable se separa del libro que es su única explicación, y la
diferencia no aparece hasta el conteo físico de fin de mes.

---

## 6. Lo que va a contabilidad, y lo que no

El sistema te da **el valor del inventario al costo promedio** (Comercio →
Existencias, y `/api/reports/inventory-valuation`). Es la cifra que el contador
necesita para el balance, y sale del sistema en vez de un conteo a mano.

**Lo que NO hace, y es deliberado:** no escribe asientos de compra ni de costo de
ventas. El mayor de este sistema es de **base caja** — cada asiento refleja un
movimiento real de dinero, y eso es lo que impide que la contabilidad se separe
de la realidad. Devengar la compra al recibirla y el costo al vender es
contabilidad de acumulación, tiene consecuencias fiscales, y el cambio de base
lo decide tu contador, no el módulo de inventario.

Si tu contador quiere acumulación, díselo al equipo de desarrollo: es un trabajo
acotado, pero es una decisión suya que hay que tomar a conciencia.

---

## 7. Para empezar

1. **Almacenes** (Comercio → Almacenes): al menos uno. Marca «admite negativos»
   solo si de verdad quieres poder sacar mercancía que el sistema no sabe que
   tienes.
2. **Artículos** (Comercio → Artículos): con su punto de pedido. Sin punto de
   pedido ni mínimo, el artículo **no tiene umbral** y nunca avisará de
   existencias bajas — el sistema no sabe cuántas necesitas tú.
3. **Órdenes de compra**: créalas, apruébalas, y añádeles líneas desde la
   pantalla de recepción.
4. **Extras de almacén**: enciende «¿Sale del almacén?» solo en los que de
   verdad salen.
