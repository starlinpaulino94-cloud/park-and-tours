# Quién trajo al cliente

## El problema que resuelve

El equipo de una operadora dominicana no es solo el que está detrás del
mostrador. Vende el conserje del hotel, vende el taxista de la parada, vende el
promotor de la playa. Esa gente **no teclea la venta** —ni tiene cuenta en el
sistema, ni la quiere— y aun así es quien trae al cliente.

Hasta aquí, el vendedor de una venta era el que alguien escogió en un
desplegable. Dos preguntas se contestaban de memoria:

> ¿Cuántos clientes me trajo el QR del Bahía Príncipe este mes?
>
> Esta venta la cerró el mostrador, pero ¿de quién era el cliente?

La primera no se podía contestar porque no se guardaba. La segunda se contestaba
por acuerdo verbal, que es como se pierden las comisiones y como se pierden los
conserjes.

---

## El hecho y la política son cosas distintas

Es la decisión de diseño que sostiene todo lo demás.

Una atribución es un **hecho**: «esta persona entró por el enlace de este
vendedor, este día, por este canal». No se edita y no se borra — y no por
convención: hay un disparador en la base que rechaza el `UPDATE` y el `DELETE`.
La única edición permitida es enlazar una visita anónima con la ficha que nace
después, porque eso no reescribe el hecho, lo completa.

A quién le toca la comisión **no** se decide al guardar el hecho. Se decide al
vender, leyendo el histórico con la política que la empresa tenga puesta.

Dos consecuencias que importan:

- **Cambiar la política no reescribe el pasado.** Pasar de «primero» a «último»
  cambia cómo se atribuyen las ventas de mañana, no las de la semana pasada.
- **El embudo se responde agrupando filas**, no reconstruyéndolo. «¿Cuántos
  clientes captó cada QR?» es una consulta, no una estimación.

---

## Las tres políticas, y a quién premia cada una

| Política | Gana | Cuándo tiene sentido |
|---|---|---|
| **Primer contacto** (por defecto) | Quien lo trajo | Premia la captación. El conserje cobra aunque la venta la cierre el mostrador tres días después: es el trabajo que nadie más iba a hacer |
| **Último contacto** | Quien lo cerró | Premia el cierre. Ojo con el efecto: quien toca al cliente se lleva todo lo siguiente hasta que otro lo toque |
| **Quien tomó la reserva** | El de la etapa de reserva | Equipos donde tomar la reserva es el trabajo real |

«Quien tomó la reserva», si esa venta no nació de una reserva atribuida, cae a la
última. Nunca se deja una comisión sin dueño por un tecnicismo.

### La ventana

Un QR escaneado hace ocho meses no es quien trajo la venta de hoy: pagarlo sería
inventar una deuda. Por defecto la atribución vive **30 días**.

Fuera de la ventana no hay atribución, y la venta queda como venta directa de la
empresa — que es la verdad, no un hueco que haya que rellenar con el último
vendedor que pasó por ahí.

**Cero días significa «no caduca nunca».** Es una elección legítima de una
operadora que trabaja con dos hoteles fijos y un acuerdo permanente.

---

## El enlace

Cada vendedor tiene uno o varios: un QR para el mostrador, otro para la playa,
otro para WhatsApp. Cada uno con su código, su canal declarado y, si se quiere,
un producto al que abre directamente — un QR que dice «Saona» debería abrir
Saona, no el catálogo entero.

### El código que va impreso

Se teclea a mano el día que la cámara falla, así que:

- **No se deriva del nombre.** El nombre cambia —una persona se casa, un hotel
  cambia de marca— y el QR ya está impreso y pegado. Sale del código comercial.
- **No lleva las letras que se confunden leyendo de un papel**: fuera O/0, I/1,
  L/1, S/5 y B/8, los dos miembros de cada pareja. Dejar el `8` y quitar la `B`
  no arregla nada, porque quien lee «8» en un cartel sigue tecleando «B».
- **Es único en todo el sistema, no por empresa.** Quien escanea no ha dicho de
  qué operadora es cliente: el slug tiene que resolver la empresa él solo, y uno
  repetido entre dos inquilinos mandaría al visitante a la competencia.

### Lo que la cookie guarda, y por qué

La cookie guarda **el slug**, no el vendedor. La cookie la escribe el cliente: si
guardara el id del vendedor, cualquiera podría editarla y atribuirse las ventas
de la operadora entera. El slug se vuelve a resolver contra la base cada vez que
se usa, así que un enlace borrado, desactivado, de un vendedor que ya no está o
de otra empresa deja de valer en el momento.

---

## El embudo

Cuatro etapas: **visita → cliente captado → reserva → compra**.

- **Visita** — alguien escaneó. Todavía no es nadie: solo hay una cookie.
- **Cliente captado** — la ficha acaba de nacer. Es la primera vez, no cada vez
  que el mismo señor vuelve a reservar: contar las vueltas como captaciones
  premiaría al vendedor cuyos clientes repiten como si trajera clientes nuevos.
- **Reserva** — se creó una venta atribuida.
- **Compra** — esa venta se cobró del todo. Se anota **una sola vez**: sin eso,
  quien cobra en tres plazos parecería el triple de bueno que quien cobra de una.

### Se cuentan personas, no clics

Un turista que recarga la página cinco veces no son cinco visitas. Contarlas como
cinco haría que el vendedor con el QR más incómodo —el que obliga a reintentar—
pareciera el mejor captador de la casa. Se cuenta por persona: la ficha si ya
existe, y si no la cookie. El mismo señor con dos navegadores es uno.

Además, la tabla no crece sin techo: una visita del mismo navegador por el mismo
enlace se vuelve a anotar como mucho cada seis horas.

### La conversión vacía se dice, no se pinta en cero

Un vendedor sin visitas tiene la conversión en «—». Cero por ciento significa que
vinieron y no compraron, que es un problema distinto y se arregla de otra manera.

---

## Qué hace la operadora para ponerlo en marcha

1. **Elige la política** en *Configuración*. Si no sabe cuál, la de por defecto
   («primer contacto») es la que premia traer clientes nuevos.
2. **Crea los tipos de vendedor** que use de verdad en *Red de ventas → Tipos de
   vendedor*: normalmente cuatro o cinco, no veinte. Existen para poder fijar una
   comisión «a todos los hoteles» sin escribir la palabra a mano en cada regla —
   «Hotel» y «hotel» serían dos tipos y una de las dos reglas no pagaría.
3. **Da de alta al conserje como vendedor.** No necesita cuenta: un vendedor sin
   usuario es perfectamente normal.
4. **Crea su enlace** en *Red de ventas → Quién trajo al cliente → Enlaces y QR*,
   descarga el QR y lo imprime.
5. **Mira el embudo** a la semana siguiente.

> La página pública de la empresa tiene que estar activada (`ola 4`). Sin ella el
> enlace no lleva a ninguna parte, y por eso un enlace de una empresa con la
> página apagada se contesta igual que uno que no existe.

---

## Dónde vive el código

| Qué | Dónde |
|---|---|
| Etapas, políticas, ventana, embudo y slug (puro, con pruebas) | `src/lib/attribution.ts` |
| Lectura y escritura contra la base | `src/lib/attribution-service.ts` |
| El QR que escanea el turista | `src/app/e/[slug]/route.ts` |
| La atribución al vender | `src/lib/booking-service.ts` |
| El embudo desde la web pública | `src/lib/public-booking-service.ts` |
| La pantalla | `src/app/dashboard/vendedores/atribucion/` |
| El esquema y el disparador de solo-añadir | `supabase/migrations/0058_seller_attribution.sql` |
| Que el histórico siga siendo un histórico | `supabase/tests/seller_attribution.test.sql` |
