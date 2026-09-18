# La logística del día: recogidas, flota y despacho

Cómo se decide a qué hora pasa el transporte por cada hotel, quién sale en qué
vehículo, y qué es un conflicto de verdad.

---

## 1. Los cuatro defectos que esto viene a arreglar

Antes de la ola 9 el esquema de recogidas llevaba años completo y casi sin usar.
Lo que había:

| Lo que la pantalla prometía | Lo que el código hacía |
|---|---|
| «Minutos antes de la salida a los que pasa el transporte» (`hotel.pickup_offset_min`) | Nada. El campo se guardaba, se pintaba y **ningún código lo leía**. La hora de recogida era la que tecleaba quien vendía. |
| Rutas que agrupan las recogidas por zona | `pickup.route_id` existía desde 0011 y **nada lo llenaba**. `stops_count` y `pax_total` eran números tecleados a mano. |
| «Conflictos de recursos antes de que ocurran» | Se contaban los usos **por día**. La guagua que hace el tour de las 8 y el de las 2 salía en rojo todas las mañanas. |
| Seguro e inspección del vehículo | Se pintaban en rojo en una pantalla. El vehículo salía igual. Al guía con la licencia vencida sí se le bloqueaba desde la ola 5. |

El cuarto es el que más duele: un sistema que bloquea a la persona y deja pasar
al vehículo no es que sea incompleto, es que **da una seguridad falsa**.

---

## 2. De dónde sale la hora de recogida

```
hora de recogida  =  hora de la salida  −  margen
```

El margen se busca en este orden:

1. **El del hotel** (`hotel.pickup_offset_min`), si lo tiene.
2. **El de su zona** (`zone.pickup_offset_min`).
3. Si no hay ninguno: **no se calcula nada** y se avisa por el nombre del hotel.

El paso 2 es el que hace el campo utilizable. Nadie carga doscientos hoteles
poniéndoles el margen uno por uno, y la zona ya los agrupa por lo único de lo
que el margen depende: dónde están.

El paso 3 es deliberado. Fabricar un cero diría «recógelo a la hora exacta de la
salida», que es una hora falsa con pinta de dato, y nadie la revisaría.

### Un cero puesto a mano sí vale

`pickup_offset_min = 0` en el hotel significa «se recoge en el punto de salida».
Es una decisión, no un hueco, y gana sobre el margen de la zona.

### La hora se calcula en la zona de la empresa

Una salida a las 08:00 de Santo Domingo son las 12:00 UTC. Calculada en UTC, al
conductor se le diría que pase a las 11:00 por un hotel al que tiene que llegar
a las 07:00. Todo esto pasa por `src/lib/time.ts`.

---

## 3. Lo prometido al cliente NO se pisa

Hay **dos horas**, y es a propósito:

| Campo | Qué es |
|---|---|
| `pickup.pickup_time` | La **prometida** al cliente. Es la que está impresa en su voucher. |
| `pickup.planned_time` | La que **calcula** el motor. |

Si el motor sobrescribiera, un cliente con un voucher que dice 07:15 pasaría a
que lo recojan a las 07:00 sin que nadie se entere. Cuando difieren, las dos
viajan juntas con el aviso al lado —en la pantalla de recogidas, en el despacho
y **en la hoja del conductor**— y quien despacha decide: o mueve al cliente
avisándole, o respeta lo pactado.

Cuando no hay nada prometido todavía, la calculada se copia: ahí no hay nada que
romper.

---

## 4. Cómo se arman las rutas

`buildRoutes` (`src/lib/dispatch.ts`) agrupa las recogidas de una salida:

1. **Por zona.** Un hotel sin zona no se pierde: va a «Sin zona». Perderlo sería
   dejar al cliente esperando en un lobby sin que nadie lo sepa.
2. **En orden de hora**, la más temprana primero. A quien se recoge con más
   antelación es a quien está más lejos, así que **la hora ya lleva dentro el
   orden del recorrido**. Las paradas sin hora quedan al final: si fueran
   primeras, el conductor arrancaría por la parada que nadie sabe cuándo es.
3. **Partidas por la capacidad del vehículo**, del más grande al más pequeño.

### Tres cosas que el motor NO hace

**No optimiza el recorrido con coordenadas.** Un optimizador de verdad necesita
tráfico y calles reales; uno basado en la línea recta daría recorridos peores
que los del conductor que lleva diez años haciéndolos, y con pinta de
calculados.

**No inventa vehículos.** Cuando se acaban los que la salida tiene asignados y
pueden salir, las paradas que sobran forman una ruta **sin vehículo** y con el
aviso de cuántas plazas faltan. Repartir turistas entre guaguas que no existen
hace que el problema aparezca en el lobby a las siete de la mañana en vez de en
la pantalla la tarde antes.

**No parte una reserva.** Una familia de nueve que no cabe en ninguna guagua se
queda junta, con su aviso. Partirla la separaría en dos vehículos.

### Armar el día se puede repetir

A media mañana entran reservas nuevas y hay que rehacerlo. Por eso:

- Cada ruta automática lleva su huella (`pickup_route.auto_key`), y rehacer
  **actualiza esa misma ruta** en vez de duplicarla.
- **No se borra para rehacer**: borrar perdería el conductor y el guía que el
  despacho asignó, que es trabajo humano y no se regenera.
- **No se tocan las rutas hechas a mano** ni las recogidas que ya están en una.
  Alguien las puso ahí por algo.
- El vehículo solo se propone si la ruta no tiene ninguno: si el despacho ya
  eligió uno, esa decisión gana sobre la del motor.
- Las rutas automáticas que se quedan sin gente se **vacían y se cancelan**, no
  se borran, para no dejar recogidas apuntando a una ruta que ya no existe.

---

## 5. Qué es un conflicto de recursos

**El mismo recurso en dos salidas que se pisan en el tiempo.** Nada más.

- La ventana de una salida va de su hora a su hora más la duración del producto
  (8 h cuando el producto no lo dice).
- Un recurso con horas propias (`departure_resource.start_time` / `end_time`)
  ocupa solo las suyas.
- **Tocarse en el borde no es pisarse**: una guagua que vuelve a las 14:00 y
  sale de nuevo a las 14:00 es el relevo ajustado de siempre. Es el mismo
  criterio que usan los turnos en `hr.ts`.
- El mismo recurso repetido **dentro** de una salida es una fila duplicada en la
  ficha, no un problema de agenda.
- Se avisa **un choque por recurso**, no uno por pareja: un vehículo metido en
  cuatro salidas que se pisan produciría seis avisos diciendo lo mismo.

---

## 6. Cuándo un vehículo no puede salir

`vehicleBlock` es el gemelo de `assignmentBlock` para las personas.

| Situación | ¿Sale? |
|---|---|
| Seguro **vencido** | **No** |
| Inspección **vencida** | **No** |
| En mantenimiento o fuera de servicio | **No** |
| Papel que vence dentro de 30 días | **Sí**, con aviso |
| Papel que vence **hoy** | **Sí**: una póliza que dice «vence el 30» cubre el 30 |
| Sin fechas cargadas | **Sí**: una operadora que aún no cargó los seguros no puede quedarse sin flota por eso |

Los treinta días son los mismos que para las certificaciones del personal.
Renovar un seguro tampoco es trámite de un día, y que el número sea el mismo
evita que la operación recuerde dos reglas para la misma idea.

Bloquear por «vence en tres semanas» dejaría a la operadora sin flota un lunes
cualquiera, y el sistema se volvería el enemigo. Para eso está el aviso.

---

## 7. La hoja de ruta del conductor

`/dashboard/operaciones/rutas/<id>/hoja`

El manifiesto dice **quién viaja**; la hoja de ruta dice **por dónde pasa el
transporte, en qué orden y a qué hora**. Sin ella el recorrido se decide en la
calle: se llega tarde al hotel más lejano, o se da la vuelta entera dos veces.

Está pensada para el papel y para un teléfono con el sol de frente: número de
parada grande, hora en la primera columna, hotel, habitación, a quién se busca y
su teléfono. Lleva una casilla en blanco para marcar a bolígrafo, porque en la
guagua no siempre hay señal; el estado real entra luego por el check-in.

Los avisos —va sobrecargada, a este cliente le prometieron otra hora— van **en el
papel**. Quien conduce es quien tiene que saberlo.

---

## 8. Lo que se deriva y no se teclea

| Dato | De dónde sale |
|---|---|
| `pickup.planned_time` | Del margen del hotel o su zona. **No es editable.** |
| `pickup.sequence` | Del orden que arma el motor. **Sí es editable**: reordenar a mano es una decisión del despacho cuando el conductor sabe algo que el motor no. |
| `pickup_route.stops_count` | De cuántas paradas tiene. También en las rutas manuales. |
| `pickup_route.pax_total` | De la suma de pax de sus paradas. |
| `pickup_route.start_time` | De la hora de su primera parada. |
| `pickup_route.auto_key` | Del motor. **No es editable**: tocarla duplicaría las rutas al rehacer el día. |

Un `stops_count` escrito a mano miente en cuanto se añade una parada, y esa
mentira acaba en la hoja del conductor.

---

## 9. Dónde vive cada cosa

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/0065_pickup_logistics.sql` | El esquema: margen de zona, hora calculada, número de parada, huella de ruta, motivo del conflicto. |
| `src/lib/dispatch.ts` | Dominio **puro**: ventanas, choques, bloqueo del vehículo, hora de recogida y armado de rutas. Sin base de datos. |
| `src/lib/dispatch-service.ts` | Lee, decide con el dominio y guarda. |
| `src/app/api/operations/dispatch` | El día completo (`GET`) y armar rutas (`POST .../routes`). |
| `src/app/api/operations/routes/[id]/run-sheet` | La hoja del conductor. |
| `src/lib/dispatch.test.ts` | 60 pruebas. Cada una corresponde a algo que se paga en el muelle. |
| `supabase/tests/pickup_logistics.test.sql` | Que rehacer el día no pueda duplicar rutas. |

---

## 10. Lo que queda fuera, a propósito

- **Optimización real de recorrido.** Necesita un servicio de rutas con tráfico.
  Hasta entonces, ordenar por hora es lo que la operación ya usa y acierta.
- **Asignar el vehículo automáticamente entre salidas.** El motor propone dentro
  de una salida; repartir la flota del día entero es una decisión con
  información que no está en la base (qué conductor conoce qué zona, qué guagua
  aguanta el camino de tierra).
- **Avisar al cliente del cambio de hora.** El desajuste se detecta y se enseña;
  mandarle el mensaje es una decisión de quien despacha, y ya hay un módulo de
  comunicaciones para hacerlo.
