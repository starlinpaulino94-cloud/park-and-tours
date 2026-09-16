# Cierre contable y estados financieros

Qué te dice el sistema de tu contabilidad, cómo se cierra un mes y por qué hay
una puerta que no se puede abrir desde aquí.

---

## 1. Los tres informes, y para qué sirve cada uno

**Finanzas → Estados financieros.**

| Informe | Responde a | Mira |
|---|---|---|
| Estado de resultados | ¿Cuánto gané? | solo el rango que elijas |
| Balance general | ¿Qué tengo y qué debo? | **todo lo acumulado** hasta el final del rango |
| Balance de comprobación | ¿Cuadran los libros? | el rango, cuenta por cuenta |

La diferencia de alcance importa: lo que la empresa *tiene* no empieza el 1 de
julio. Antes solo existía el tercero, que es una herramienta de contable — el
dueño no pregunta si cuadra el mayor, pregunta cuánto ganó.

Dos detalles que suelen salir mal en otros sistemas y aquí están resueltos:

- **Los descuentos restan de las ventas, no suman a los gastos.** Un descuento
  no es un costo de operar, es venta que no se hizo. Contarlo como gasto infla a
  la vez las ventas y los costos: el resultado neto cuadra igual, pero el margen
  bruto miente.
- **El resultado del ejercicio en curso aparece en el patrimonio** como línea
  propia. Todavía no está en «Resultados acumulados» —eso lo hace el asiento de
  cierre— y sin sumarlo el balance no cuadra nunca.

Si el balance **no cuadra**, la pantalla lo dice con la diferencia exacta en vez
de enseñar un número bonito. Casi siempre es un asiento contra una cuenta de
naturaleza equivocada; se busca en el libro diario.

---

## 2. Cerrar el mes

Tres estados, y la diferencia entre los dos últimos es lo que hace que esto
sirva:

| Estado | Significa | ¿Se puede deshacer? |
|---|---|---|
| **Abierto** | el mes corriente | — |
| **Cerrado** | el contador lo revisó y lo dio por bueno | **sí**, se reabre |
| **Declarado** | ya se envió a la DGII | **no** desde el sistema |

**Con el periodo cerrado, el sistema rechaza cualquier asiento con esa fecha.**
Antes no: el 607 se enviaba el día 20 y nada impedía registrar un pago con fecha
del mes anterior. A partir de ahí lo declarado y los libros decían cosas
distintas, y la diferencia solo aparecía cuando la DGII cruzaba los
comprobantes — meses después y con recargo.

Un cierre que siempre se puede deshacer no protege nada, y uno que nunca se
puede deshacer obliga a saltárselo el primer día que el contador se equivoca. Por
eso son dos pasos.

**Corregir un mes declarado es una rectificativa ante la DGII**, que es una
conversación con tu contador, no un botón en un ERP.

Al cerrar se guarda el retrato de las cifras del momento (débitos, créditos y
resultado). Si después se reabre y alguien toca algo, la diferencia con esas
cifras es la pregunta que hay que responder.

---

## 3. Cerrar el ejercicio

Una vez al año, **Finanzas → Estados financieros → Llevar el resultado a
acumulados**.

Salda los ingresos y los gastos del año contra `3201 Resultados acumulados`.
Sin este asiento, los ingresos y los gastos de un año siguen ahí el año
siguiente: el estado de resultados del segundo ejercicio incluiría el primero y
el balance general no cuadraría jamás. La cuenta estaba en el plan desde el
principio y nada escribía nunca en ella.

Es **un asiento de verdad**, no una bandera: se ve en el libro diario y se puede
reversar como cualquier otro. Se hace **una sola vez por ejercicio** — un
segundo cierre duplicaría el resultado en acumulados.

---

## 4. Las tres declaraciones de la DGII

**Finanzas → Declaraciones DGII.**

| Formato | Qué declara |
|---|---|
| 606 | compras y gastos del mes |
| 607 | ventas del mes |
| **608** | **comprobantes anulados** |

El 608 es el que más se olvida. La DGII cruza los NCF emitidos con los anulados:
un comprobante que se anuló y no se declaró **sigue contando como venta**.

Al anular una factura el sistema pide el motivo escrito (para una inspección) y
guarda además el **código de anulación** que el formato exige. Son dos cosas
distintas por más que se parezcan: el código es uno de nueve y la DGII rechaza el
archivo entero si llega otro. Si no eliges uno, se usa **05 — Corrección de la
información**, que es lo que de verdad ocurre al anular desde el sistema.

Los nueve códigos:

`01` deterioro de factura preimpresa · `02` errores de impresión · `03` impresión
defectuosa · `04` duplicidad de factura · `05` corrección de la información ·
`06` cambio de productos · `07` devolución de productos · `08` omisión de
productos · `09` errores en secuencia de NCF

> Las anulaciones se declaran por la fecha en que se **emitió** el comprobante,
> no por la de anulación: una factura de agosto anulada en septiembre va en el
> 608 de agosto.

---

## 5. Una nota sobre la base contable

El mayor de este sistema es de **base caja**: cada asiento refleja un movimiento
real de dinero. Eso es lo que impide que la contabilidad se separe de la
realidad, y es una decisión deliberada, no una limitación.

Consecuencia práctica: **no hay asientos de devengo**. Una compra recibida no
genera asiento hasta que se paga, y el costo de la mercancía vendida no se
registra al vender. Para el inventario, lo que el sistema te da es la
**valoración al costo promedio** (Comercio → Existencias), que es la cifra del
balance.

Si tu contador necesita contabilidad de acumulación, es un trabajo acotado pero
tiene consecuencias fiscales: la decisión es suya, y hay que tomarla a
conciencia antes de tocar nada.

---

## 6. Rutina mensual sugerida

1. **Día 1–5**: revisar el libro diario del mes anterior y el balance de
   comprobación. Que cuadre.
2. **Día 5–10**: generar 606, 607 y 608; revisar las líneas que el sistema deja
   fuera (las enseña con el motivo) y corregir el origen.
3. **Día 10**: **cerrar el periodo**.
4. **Antes del 20**: subir los tres archivos a la DGII y **marcar el periodo como
   declarado**.
5. **Exportar el balance de comprobación** para tu contador desde la misma
   pantalla (CSV con BOM, se abre bien en Excel en español).
