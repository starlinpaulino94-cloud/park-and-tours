# Comisiones: explicarlas y corregirlas

## El fallo que esto arregla, y por qué nadie lo había visto

El enum `calc_type` declara seis tipos de cálculo desde la primera migración, y
la pantalla de comisiones los ofrece los seis. El motor implementaba **cuatro**:
`net_rate` y `markup` caían al `return` final y se calculaban como **porcentaje**.

Lo que eso significa en una operadora real: alguien configura «Tarifa neta 45»
—queriendo decir *«la agencia me deja 45 dólares netos por pasajero»*— y el
sistema le paga el 45 % de la venta.

Nadie lo reportó en dos años porque **una comisión mal calculada no da error:
da una cifra**. Es la clase de fallo que solo aparece si alguien cruza a mano lo
que la pantalla ofrece contra lo que el motor implementa — y ahora hay una
guarda que lo cruza en cada ejecución de las pruebas.

---

## Los nueve tipos de cálculo

| Tipo | Qué significa `valor` | Fórmula |
|---|---|---|
| **Porcentaje** | % sobre la venta | `base × v/100` |
| **Monto fijo** | Importe por venta | `v` |
| **Fijo por adulto** | Importe por adulto | `v × adultos` |
| **Fijo por niño** | Importe por niño | `v × niños` |
| **Fijo por pasajero** | Importe por persona | `v × (adultos + niños)` |
| **Escalonado** | — (usa los escalones) | El escalón donde cae el listón |
| **Por volumen** | — (usa los escalones) | El escalón donde cae lo acumulado del periodo |
| **Tarifa neta por pasajero** | Lo que la operadora se queda por persona | `base − v × pax` |
| **Markup incluido en el precio** | % de margen que ya lleva el precio | `base − base / (1 + v/100)` |

**El markup es una resta, no una multiplicación.** Un precio de 120 que ya lleva
dentro un markup del 20 % viene de un neto de 100: el margen son 20, no 24.
Calcularlo como `120 × 20 %` se pasa de largo un 20 %.

**La tarifa neta con la venta por debajo del neto da cero**, no una deuda del
vendedor. Y si la venta no declara pasajeros, el desglose lo dice en vez de
pagar la venta entera.

### Un tipo que el motor no conozca paga cero **y lo grita**

Es exactamente lo que hacía el código anterior en silencio. Ahora el desglose
dice «Tipo de cálculo «X» no reconocido: comisión en cero — revisa la regla», y
ese texto acaba impreso en la liquidación del vendedor, que es quien lo va a
leer.

---

## El desglose

Cada comisión guarda una frase en español que explica su cifra:

> `10.00 USD × 3 adultos`
>
> `15 % sobre 600.00 USD (escalón de 11 en adelante, 14 pasajeros)`
>
> `Tarifa neta: 240.00 USD − 45.00 USD × 2 pasajeros`

El *snapshot* ya guardaba los datos, pero un JSON no se le enseña a un conserje
que discute su liquidación por WhatsApp. La frase cierra esa conversación;
`{"calc_type":"per_adult","value":10}` la alarga.

También se congelan los **pasajeros** que se comisionaron. Sin eso, recalcular
un «por adulto» de hace tres meses tendría que ir a buscar la reserva — que
puede haberse reprogramado con otra gente.

---

## El tope a la base

El importe nunca pasa de lo que entró. Una regla que da más es **siempre** un
error de configuración: un «fijo por venta» de 200 en un tour de 120, una tarifa
neta puesta al revés. Se topa y se dice en el desglose:

> `200.00 USD fijos por venta — topado a 120.00 USD: la regla daba más de lo que entró`

Topar y decirlo vale más que pagar de más y descubrirlo en la liquidación.

---

## Escalones por pasajeros

El acuerdo que de verdad se firma con un touroperador mira **pasajeros**:

> De 1 a 10 pax, 10 %. De 11 en adelante, 15 %.

Con escalones por importe, un grupo de 20 personas en un tour barato cobra menos
que una pareja en uno caro — lo contrario de lo pactado. La regla ahora dice
contra qué se mide (`tier_basis`), y el defecto sigue siendo el importe: ninguna
regla ya guardada cambia de cálculo.

---

## Vigencia por fecha de venta

Hay dos acuerdos distintos y hasta ahora solo se podía expresar uno:

- **Temporada** (`season_from`/`season_to`) acota por fecha de **viaje**: «en
  temporada alta se comisiona distinto».
- **Vigencia** (`effective_from`/`effective_to`) acota por fecha de **venta**:
  «esta campaña vale para lo que se venda en octubre, viajen cuando viajen».

El último día de la campaña cuenta entero: comparar contra su medianoche dejaría
fuera todo lo vendido ese día, que es justo cuando más se vende en una campaña
que acaba.

---

## Una comisión pagada no se anula: se ajusta

### Lo que pasaba

Cancelar una reserva ponía sus comisiones `pending` y `approved` en `cancelled`,
y a las `settled` y `paid` **no las tocaba**. O sea: el dinero salió, la venta se
cayó, y en el sistema no quedaba ni rastro de que hubiera que recuperarlo. La
liquidación del mes siguiente cuadraba con una venta que ya no existe.

### Cómo funciona ahora

La decisión depende de si el dinero ya salió, no del capricho de quien cancela:

| Estado | Qué pasa |
|---|---|
| `pending`, `approved`, `held`, `disputed` | Se **anula**. No hay nada que corregir |
| `settled`, `paid` | Se **ajusta** en negativo por su neto vivo, y **conserva su estado** |
| `cancelled`, o neto ya en cero | **Nada**. Ajustar dos veces descontaría dos veces |

Una comisión ajustada **sigue diciendo que se pagó**, porque se pagó. Poner
`cancelled` sobre dinero que salió es justo la mentira que el ajuste evita.

Cuando hay ajustes por cancelación, se escribe además un aviso de auditoría con
lo que hay que recuperar en la próxima liquidación — y la respuesta de la
cancelación lo devuelve, para que quien cancela lo vea en el momento y no un mes
después.

### El ajuste tampoco se edita

Corregir la corrección editándola deja el histórico diciendo que siempre fue así.
Lo que procede es **otro ajuste**, que es justo lo que esta tabla hace barato. Un
disparador en la base lo impide; la única excepción es engancharlo a la
liquidación que lo paga, porque eso pasa después y no cambia ni el importe ni el
motivo.

### El neto nunca es negativo

Si los ajustes se comen más que el importe, el neto se queda en cero. Una
comisión no se convierte en una deuda del vendedor: lo pagado de más se persigue
por otra vía —la siguiente liquidación, una conversación— y no dejando un número
en rojo que la pantalla sumaría como si fuera cobrable.

### Y no se crea por el CRUD genérico

`writable` está vacío a propósito. Crear un ajuste por ahí escribiría la fila y
dejaría `net_amount` sin recalcular, y un neto desfasado lo suma la liquidación
del mes siguiente sin que nada avise. La ruta dedicada escribe el ajuste,
sincroniza el neto y deja rastro, en ese orden.

---

## La máquina de estados

```
pending ──→ approved ──→ settled ──→ paid      (terminal)
   │            │            │
   └────────────┴────────────┴──→ held / disputed / cancelled
```

`paid` es terminal. Y el rechazo se explica en palabras:

> «Esta comisión ya se pagó. Lo que haya que corregir se hace con un ajuste, no
> borrando el pago.»

Un «no permitido» a secas hace que la persona lo intente por otro camino —el
editor de SQL, normalmente— y ahí ya no hay quien lo pare.

---

## Dónde vive el código

| Qué | Dónde |
|---|---|
| El cálculo, la especificidad y la vigencia | `src/lib/commission-engine.ts` |
| Ajustes, neto y máquina de estados (puro) | `src/lib/commission-adjustments.ts` |
| Los ajustes contra la base | `src/lib/commission-adjust-service.ts` |
| La cancelación de una reserva | `src/lib/booking-cancel-service.ts` |
| La ruta del ajuste | `src/app/api/commissions/adjust/route.ts` |
| La pantalla | `src/app/dashboard/comisiones/page.tsx` |
| El esquema y los disparadores | `supabase/migrations/0059_commission_depth.sql` |
| Que un ajuste siga siendo un movimiento contable | `supabase/tests/commission_adjustment.test.sql` |
