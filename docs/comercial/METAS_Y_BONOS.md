# Metas comerciales y bonos

## La meta que había era un número

`seller.monthly_goal`: un número suelto, sin unidad declarada —¿pesos?
¿pasajeros? ¿ventas?— y sin más periodo que «el mes». La pantalla lo pintaba
como dinero y nada lo obligaba a serlo.

Lo que una operadora pone de verdad en una reunión de lunes:

> «Este mes, el equipo de playa: 40 ventas y 150 pasajeros.»
>
> «Los hoteles: 30 clientes nuevos captados, el resto me da igual.»
>
> «Rafael, en la excursión a Saona, 20 reservas de aquí al 15.»

Ninguna de las tres cabe en un número. Y la tercera —una meta sobre **un**
producto, en **un** rango de fechas, para **una** persona— es la más común de
todas cuando hay que empujar una salida que no se llena.

---

## Cómo se define una meta

Tres ejes, todos opcionales y combinables:

| Eje | Opciones |
|---|---|
| **A quién** | Un vendedor · un tipo de vendedor · una sucursal · (nada = toda la red) |
| **Sobre qué** | Un producto · una categoría · (nada = todo lo que venda) |
| **Cuándo** | Diaria · semanal · mensual · entre dos fechas |

Y **cinco dimensiones** independientes: clientes captados, reservas, ventas
cerradas, pasajeros, ingresos.

### Se cumple cuando se cumplen TODAS

«40 ventas y 150 pasajeros» es **una** meta con dos condiciones. Dar por buena
la primera y pagar el premio sería regalarlo a medias.

Y una meta que no pide nada **no** está cumplida: no se puede cumplir algo que
no se pidió, y darlo por bueno pagaría premios por nada. La base lo impide con
una restricción, así que esa fila ni siquiera se puede crear.

### Solo se pinta lo que la meta pide

Una meta de pasajeros **no** enseña una barra de ingresos en cero. Esa barra no
significa nada y hace que el vendedor lea que va fatal en algo que nadie le
pidió. Vacío es «esta meta no habla de eso», que no es cero.

### La semana empieza el lunes

En una operadora dominicana el fin de semana es el pico de ventas. Cortar la
semana en mitad del sábado partiría en dos el dato que más importa.

---

## El progreso se mide, no se guarda

No hay contadores que mantener:

- **Clientes captados** salen del embudo de atribución (0058), contando
  **personas**: el mismo cliente captado dos veces es uno.
- **Reservas, ventas, pasajeros e ingresos** salen de las reservas.

Un contador denormalizado sería un segundo sitio donde se decide si alguien
cobra su premio, y el día que se desincronizara nadie lo notaría — porque nadie
mira un contador, solo la barra que pinta.

Dos decisiones que cambian las cifras:

- **Se mide por fecha de venta, no de viaje.** La meta de septiembre premia lo
  que se vendió en septiembre, aunque el grupo viaje en enero.
- **Una reserva en borrador, pendiente o cancelada no cuenta.** Si contara, un
  vendedor llegaría a su meta creando reservas que nunca se cobran.
- Los **bebés** cuentan como pasajeros: viajan gratis pero ocupan asiento y van
  en el manifiesto. Para una meta de pasajeros son gente que el vendedor trajo.

---

## El bono no es una comisión

Y por eso no vive en la misma tabla.

Una **comisión** nace de una venta concreta, se calcula con una regla y se puede
rastrear hasta su reserva. Un **bono** nace de *haber llegado* a algo —una meta,
una temporada, un acuerdo verbal— y no tiene reserva detrás. Meterlo en
`commission` obligaría a inventarle una venta, y esa venta falsa saldría en el
informe de ventas.

Lo que sí comparten es la liquidación: al vendedor se le paga todo junto.

### Lo otorga una persona

Nada se otorga solo. Un premio automático sobre una meta que alguien bajó el día
30 se pagaría sin que nadie lo mirara, y esa es la clase de bono que acaba en una
discusión.

Lo que **sí** es automático es la **condición congelada**: se guarda lo que la
meta pedía y lo que se alcanzó aquel día. Dentro de seis meses «Bono de
septiembre · 100 USD» no se puede defender sin eso — la meta puede haberse
editado o borrado, y lo que se cumplió aquel día no.

Y no se otorga dos veces: dos clics seguidos, o un reintento, encuentran que ese
vendedor ya tiene el bono de esa meta.

---

## Lo que no es dinero no se transfiere

Un bono puede ser un premio en especie: dos pases para la excursión, una noche de
hotel. Eso **tiene un valor** —cuenta para el expediente y para la declaración de
la operadora— pero **no se transfiere**.

Sumarlo al total a pagar haría que la operadora transfiriera dinero por un pase
que ya regaló. Y el vendedor no va a ser quien lo reporte.

Por eso la liquidación lleva tres cifras separadas:

| Campo | Qué es |
|---|---|
| `commission_total` | El **neto** de las comisiones, tras los ajustes firmados de 0059 |
| `bonus_total` | Los bonos **en efectivo** |
| `in_kind_total` | El valor de lo **ya entregado**. Aparece en el documento, no en la transferencia |

Lo que sale del banco es `commission_total + bonus_total`, y eso es también el
importe de la cuenta por pagar: un premio ya entregado no se debe.

### La liquidación paga el neto, no el importe

Una comisión con ajustes —una venta que se cayó después de pagarse, una
corrección— vale su **neto**. Sumar el importe original pagaría otra vez lo que ya
se descontó, y el descuadre aparecería en el banco y no en ninguna pantalla.

---

## Qué hace la operadora

1. **Crea los tipos de vendedor** que use (*Red de ventas → Tipos de vendedor*),
   si quiere metas por grupo.
2. **Crea la meta** en *Red de ventas → Metas y premios → Metas*. Deja vacío todo
   lo que no quiera medir.
3. **Mira «Cómo van»**: el progreso se calcula al abrir la pantalla, ordenado por
   quién está más cerca — que es donde un empujón cambia algo.
4. Cuando una meta sale como cumplida, **otorga el bono** y decide si es en
   efectivo o en especie.
5. **Aprueba el bono** en *Bonos y premios*. Solo los aprobados entran en la
   siguiente liquidación.

---

## Dónde vive el código

| Qué | Dónde |
|---|---|
| Periodos, progreso, totales de bono (puro, con pruebas) | `src/lib/seller-goals.ts` |
| Medir lo real y otorgar el bono | `src/lib/seller-goals-service.ts` |
| La API del tablero | `src/app/api/seller-goals/route.ts` |
| La liquidación que los paga | `src/app/api/settlements/generate/route.ts` |
| Las pantallas | `src/app/dashboard/vendedores/{metas,bonos}/` |
| El esquema | `supabase/migrations/0060_seller_goals_and_bonuses.sql` |
| Que una meta vacía no exista | `supabase/tests/seller_goals.test.sql` |
