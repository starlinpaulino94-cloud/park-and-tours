# La lista de espera

Qué pasa cuando una salida se llena, cómo se recupera esa venta, y las
decisiones de diseño que hacen que el módulo sirva en vez de estorbar.

---

## 1. El problema

Saona se llena el jueves. El viernes llama una familia de cuatro. La respuesta
es «lo siento, está lleno», se van a la competencia, y en el sistema no queda
ni rastro de que existieron: ni cuántos se quedaron fuera, ni a quién avisar
cuando alguien cancele el sábado.

`departure.waitlist_pax` existía desde la migración 0030. Se escribía a cero en
dos sitios y no lo leía nadie — el mismo caso que `hotel.pickup_offset_min`
antes de la ola 9.

---

## 2. La decisión que gobierna todo: ofrecer es crear la reserva

Cuando se libera una plaza, al primero de la cola que quepa **se le crea la
reserva**, no se le manda un aviso.

La alternativa parece más simple y es peor. Entre el aviso y la llamada del
cliente, cualquiera compra ese asiento en el mostrador. El cliente llega
habiendo sido avisado de algo que ya no existe.

Con una reserva de verdad:

- el asiento cuenta como `pending_pax` igual que cualquier otro, así que **nadie
  más puede venderlo**;
- caduca solo por el camino que ya existía desde la ola 3 (`order.hold_until` +
  `releaseExpiredHolds`);
- convertir es sencillamente **cobrar**.

No hizo falta ningún mecanismo de retención nuevo ni tocar el motor de
disponibilidad.

### El plazo se escribe, no se hereda

`createOrderWithBookings` pone `hold_until` solo si la empresa tiene política de
retención configurada. Una operadora sin esa política habría dejado la plaza
guardada **para siempre** a nombre de quien no contestó, y la lista habría
pasado de recuperar ventas a bloquearlas. La oferta escribe su propio plazo.

**24 horas**, y nunca más allá de la salida. Bastante para que alguien que está
de excursión conteste esa tarde o a la mañana siguiente; poco como para no
bloquear una plaza que el de al lado compraría hoy.

---

## 3. A quién le toca

La cola va **por orden de llegada**. Sin prioridades y sin orden manual: es lo
único que un cliente acepta sin discutir y lo único que el vendedor puede
defender delante de él. Un campo de prioridad acabaría usándose para colar a
alguien, y entonces la lista deja de ser una lista.

Dos reglas que no son obvias:

**Se respeta el orden, pero no se para en el primero que no cabe.** Una familia
de cinco delante de una pareja, con tres plazas libres: si la cola se parara
ahí, las tres plazas saldrían vacías y los dos clientes se quedarían sin viajar.
Se salta a quien no cabe y se sigue bajando.

**No se parte una espera.** Ofrecerle tres plazas a una familia de cinco es
ofrecerle dejar a dos en tierra. Quien se apuntó por cinco quiere cinco: se
queda en la cola, en su sitio, para la próxima liberación.

---

## 4. Cuándo se ofrece

**En la cancelación**, no en un reloj. Una plaza que se libera el sábado por la
mañana para una excursión del domingo no puede esperar al cron de las tres de la
madrugada. Es la misma lección que ya estaba escrita para el cupo de las OTA:
lo que importa no es barrer, es reaccionar al hecho.

El cron nocturno hace lo que la reacción no puede: marca vencidas las ofertas a
las que nadie contestó, y vuelve a ofrecer esas plazas. Va **después** de
`releaseExpiredHolds`, que es quien cancela la reserva; así las dos cosas dicen
lo mismo y la plaza recién soltada pasa al siguiente en el acto.

---

## 5. Apuntarse cuesta diez segundos

El alta se ofrece **en el punto de venta, en el instante en que la venta no
cabe**. El servidor ya distinguía ese caso con el código `OVERSELL` desde la
ola 4, y lo único que se hacía con él era pintar el mismo mensaje rojo que con
cualquier otro error.

Si apuntar exigiera salir del punto de venta, buscar la salida y abrir otra
pantalla, el vendedor diría «lo siento, está lleno» y el cliente se iría. Por
eso tampoco hace falta ficha de cliente: **basta un nombre y un teléfono**. Lo
que no se admite es una espera sin ninguna forma de avisar, y eso lo impide la
base, no solo el formulario.

La ficha de cliente se crea **al aceptar la plaza**, que es el momento natural:
quien acepta deja de ser un teléfono en una libreta y pasa a tener una reserva a
su nombre.

---

## 6. Cómo acaba cada espera

| Estado | Qué significa |
|---|---|
| `waiting` | En la cola, sin plaza apartada. |
| `offered` | Se le creó la reserva y tiene hasta `offer_expires_at`. |
| `converted` | **Pagó.** |
| `expired` | Se le pasó el turno, o la salida ya salió. |
| `cancelled` | Se dio de baja, o el vendedor la quitó. |

**`converted` es la que pagó, no la que tiene reserva.** Una reserva creada por
una oferta y nunca pagada es una plaza que se guardó y se perdió. Contarla como
venta recuperada le daría a la lista un mérito que no tuvo — y ese número es
justo el que la operadora va a mirar para decidir si el módulo sirve.

Una oferta caducada **no devuelve el turno a la cola**: pasa al siguiente. Quien
no contestó en 24 horas tuvo su oportunidad, y la plaza tiene que seguir
moviéndose.

---

## 7. Dónde vive cada cosa

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/0066_waitlist.sql` | La tabla, con el contacto obligatorio y la cola que muere con su salida. |
| `src/lib/waitlist.ts` | Dominio **puro**: orden de la cola, a quién le toca, la ventana, el desenlace. |
| `src/lib/waitlist-service.ts` | Apuntar, ofrecer creando la reserva, caducar, y el resumen. |
| `src/app/api/waitlist` | Alta, baja y consulta de la cola. |
| `src/app/dashboard/salidas/[id]/espera` | La cola de una salida, con el puesto de cada uno. |
| `src/app/dashboard/pos` | El alta en el instante en que la venta no cabe. |
| `src/lib/waitlist.test.ts` · `waitlist-service.test.ts` | 52 pruebas. |
| `supabase/tests/waitlist.test.sql` | Que las reglas de la base muerdan. |

---

## 8. Un fallo de diseño que encontró la prueba

La primera versión de 0066 ponía `customer_id ... on delete set null`. Al borrar
un cliente cuya espera no tenía teléfono propio, la fila se quedaba sin ninguna
forma de contacto, el `check` la rechazaba y Postgres abortaba el borrado
**entero**: una espera pendiente impedía borrar la ficha de un cliente que pedía
que borraran sus datos.

Ahora es `cascade`, que además de resolverlo es lo correcto: una espera es un
dato personal de esa misma persona —su nombre, su teléfono, qué quería
comprar— y se va con su ficha. La espera de mostrador, que nunca tuvo ficha, se
queda: su teléfono sigue sirviendo.

---

## 9. Lo que deliberadamente NO hace

- **No avisa al cliente automáticamente.** El aviso va al mostrador, porque la
  plaza ya está apartada a su nombre y lo que falta es que alguien le llame y le
  cobre. Un correo automático llegaría sin contexto —«tienes una reserva que no
  hiciste»— y sin nadie que cierre la venta.
- **No tiene prioridades.** Ver arriba.
- **No cobra al apuntarse.** Una lista de espera con depósito es otro producto,
  y convierte un gesto de diez segundos en una transacción.
- **No se apunta sola.** Que una venta falle por cupo ofrece apuntar; no lo hace
  por su cuenta. Apuntar a alguien sin preguntarle llena la cola de gente que no
  quiere estar en ella, y entonces la cola deja de significar nada.
