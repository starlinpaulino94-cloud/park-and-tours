# Analítica: ¿vuelven? y ¿va a salir llena?

## Qué faltaba

El área de Analítica era un índice de enlaces a informes que ya existían. Todos
contestan la misma pregunta con distinto corte: **qué pasó**. Ninguno contestaba
las dos que de verdad cambian decisiones en una operadora.

---

## 1. ¿Vuelven? — Cohortes

*Analítica → Cohortes*

Cada fila es el grupo de clientes que **compró por primera vez** ese mes. Las
columnas son los meses siguientes, y cada celda dice qué parte de ese grupo
volvió a comprar.

Sin esto, la única métrica disponible es «vendí más que el mes pasado» — que
también sube gastando más en publicidad, y una operadora que crece así deja de
crecer el día que deja de pagar.

### Cómo leerla

- **Un cliente no cambia de fila cuando vuelve.** Pertenece para siempre a la
  cohorte de su primera compra. Reasignarlo —que es el error habitual— haría que
  la retención saliera perfecta siempre, porque todo el mundo estaría siempre en
  su primer mes.
- **Comprar tres veces el mismo mes no cuenta tres veces.** La retención mide si
  *volvió*, no cuánto.
- **El triángulo vacío de abajo a la derecha no es un fallo**: son meses que
  todavía no han ocurrido para esas cohortes.
- **El ingreso se atribuye a la cohorte de alta**, no al mes de la compra: es lo
  que permite comparar qué grupo de clientes vale más.

### Qué se cuenta

Solo reservas válidas (confirmadas, pagadas, embarcadas o completadas). Contar
las canceladas inflaría la retención con clientes que pidieron y no llegaron a
viajar.

---

## 2. ¿Va a salir llena? — Previsión de ocupación

*Analítica → Previsión de ocupación*

La decisión de mañana —confirmar el segundo autobús, soltar cupo, hacer una
oferta de última hora— se toma **hoy**, con la salida a medio vender. Mirar
cuánto lleva vendido no basta: hay que saber cuánto **suele** llevar vendido a
esa misma distancia.

### La curva de anticipación

En turismo la venta no es lineal. Una salida a 30 días lleva vendido poco, y a 3
días se llena de golpe. Esa forma es estable por operadora, y es lo que permite
prever:

```
previsión = vendido_hoy ÷ curva[días_que_faltan]
```

Es la técnica de *pickup* de toda la vida. Lo importante es que **la curva se
aprende de las salidas pasadas de esta misma operadora**, no de un supuesto de
manual: cada operadora tiene la suya, y la de un tour de día completo desde un
hotel no se parece a la de una excursión que se vende por agencia.

Tres cosas que sostienen que el número sea utilizable:

- **Se aprende solo de salidas ya ocurridas.** Meter las futuras —que están a
  medio vender— haría creer que la venta se desploma cerca de la fecha.
- **Se promedia por salida, no por plaza.** Si no, una sola salida grande
  impondría su forma a todas las demás.
- **Lo vendido incluye lo retenido.** Una plaza en retención ocupa el asiento;
  prever sin ella diría que hay sitio de sobra justo en la salida que está a
  punto de llenarse.

### Cuándo el sistema NO prevé, y lo dice

| Situación | Qué se contesta |
|---|---|
| Menos de una salida pasada con ventas | «Todavía no hay salidas pasadas suficientes» |
| La salida está muy lejos (a esa distancia suele haber vendido casi nada) | «Queda demasiado tiempo» |
| Pocas salidas de las que aprender | Confianza **Indicio**, con el número de salidas |
| Sin capacidad declarada | No hay porcentaje que dar |

A 80 días con el 2 % vendido, dividir entre 0,02 convertiría dos plazas en cien.
Por eso hay un mínimo por debajo del cual **no se divide**.

**La confianza se enseña siempre.** Una previsión con tres salidas detrás y otra
con trescientas no valen lo mismo, y sin ese número tendrían el mismo aspecto.

---

## 3. Las alertas

Una alerta que no lleva a una acción es ruido, y el ruido hace que se dejen de
mirar las que sí importan. Por eso son pocas:

| Alerta | Cuándo | Gravedad |
|---|---|---|
| **Sobreventa** | Hay más vendido que capacidad | Crítica |
| **Sin ninguna reserva** | Sale en ≤ 3 días y no hay nadie | Aviso |
| **Camino de media entrada** | Previsión por debajo del 50 % | Aviso si sale pronto, informativa si no |
| **Camino de llenarse** | Previsión ≥ 90 % | Informativa: asegurar vehículo y guía |

Dos reglas que las hacen creíbles:

- **Solo dentro del horizonte en el que se puede hacer algo** (21 días por
  defecto). Una salida a cuatro meses no admite ninguna decisión hoy.
- **Una previsión sin confianza no dispara alerta de ocupación.** Decirle a
  alguien «cancela el autobús» basándose en dos salidas pasadas es peor que no
  decirle nada.

La sobreventa y el «cero reservas» sí se avisan siempre: son hechos, no
pronósticos.

---

## 4. Con cuánta antelación reservan

Los tramos están separados en corto (mismo día, 1, 2, 3 días) a propósito. En
una operadora de destino casi todo pasa ahí —el turista reserva desde el hotel—
y un tramo de «0 a 30 días» escondería justo la parte que hay que gestionar.

Sirve para dos cosas concretas: decidir hasta cuándo tiene sentido dejar abierta
la venta, y saber si una campaña movió de verdad la anticipación o solo adelantó
reservas que iban a llegar igual.

---

## Qué le toca a la operadora

- [ ] **Declarar la capacidad de las salidas.** Sin capacidad no hay porcentaje
      de ocupación ni previsión posible.
- [ ] **Dejar pasar unas semanas.** La curva necesita salidas ya ocurridas; con
      menos de ocho, la confianza sale como «indicio» y así hay que tomarla.
- [ ] Si los umbrales por defecto (50 % / 90 % / 21 días) no encajan con la
      operación, decirlo: viven en `DEFAULT_THRESHOLDS`.

## Dónde vive el código

| Qué | Dónde |
|---|---|
| Los cálculos (puro, con pruebas) | `src/lib/analytics.ts` |
| Las lecturas | `src/lib/analytics-service.ts` |
| La API | `src/app/api/analytics/{cohorts,occupancy}` |
| Las pantallas | `src/app/dashboard/analitica/{cohortes,ocupacion}` |
