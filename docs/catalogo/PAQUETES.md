# Paquetes: vender varias actividades como una

## Lo que no se podía hacer

«Saona + Buggy + Hoyo Azul, tres días, 180 dólares» es el producto que más
margen deja y el que una operadora pone en la portada. Hasta aquí, un producto
era atómico.

Lo que se hacía: teclear tres reservas sueltas y cobrar a mano un precio que no
es la suma. El descuento del paquete vivía en la cabeza de quien vendió, y el
día que el cliente quería cancelar, nadie sabía cuánto valía cada parte.

---

## Por qué no es «un producto con un precio más barato»

Porque cada actividad del paquete tiene **su** salida, **su** cupo y **su**
check-in, en días distintos. Si el combo fuera un producto suelto:

- el autobús de Saona del jueves no sabría que lleva a esa gente;
- el manifiesto del buggy del viernes no los tendría;
- y el cupo de las tres salidas no bajaría, así que se sobrevendería.

## Cómo se modela

Una venta de combo son **N+1 reservas** en la misma orden:

| | |
|---|---|
| **Cabecera** | El producto-combo y el **precio** del paquete. No tiene salida: el paquete no sale ningún día, salen sus actividades |
| **Componentes** | Uno por actividad, con su salida real, sus pasajeros y su check-in. Su importe es **cero** — el dinero está en la cabecera— pero consumen cupo y aparecen en su manifiesto |

La alternativa era repartir el precio entre los componentes. Se descartó: el
descuento del paquete no se puede repartir de una forma que no mienta
—¿proporcional al precio de catálogo? ¿a la duración?— y el día que el cliente
quiera cancelar **una** actividad habría que decidir cuánto vale esa parte de un
precio que nunca fue por partes.

Con la cabecera, la respuesta es la que el negocio ya usa: se cancela el paquete
entero con su política, o no se cancela.

### Solo dos niveles

Un componente no puede ser cabecera de otro, y un paquete no puede contener otro
paquete. Las dos cosas las impide la base, no una convención.

El anidamiento se prohíbe a propósito: un paquete de paquetes multiplica el
itinerario por combinaciones que ningún vendedor puede revisar antes de cobrar,
y el día que uno de los dos cambie de horario nadie sabría qué venta quedó rota.

---

## El motor de itinerarios

Dado un paquete, un día de inicio y un grupo, encuentra **una salida real con
plazas** para cada actividad, de forma que no choquen.

**No inventa salidas.** Solo elige entre las que la operadora ya tiene
programadas y abiertas, con las plazas que de verdad quedan. Un motor que
«encuentra» una salida que no existe es un motor que vende algo que no se puede
operar.

### El margen entre actividades no es un detalle

Dos actividades que no se solapan por un minuto no forman un itinerario: hay que
llegar de una a otra. El margen lo declara la operadora en el paquete, porque
depende de la zona: media hora en Bávaro, dos horas si hay que cruzar a Samaná.

### Explora, no coge lo primero que encaja

Un algoritmo voraz falla en el caso más común: Saona sale a las 7:00 y ocupa
todo el día, así que si se coge primero, el buggy de ese día ya no cabe. La
respuesta correcta suele ser mover una actividad a otra hora o a otro día, y eso
un voraz no lo encuentra nunca.

Con un tope de combinaciones exploradas: un mostrador con un cliente delante no
espera, y un paquete de seis actividades con seis salidas cada una son 46.656
caminos. Al llegar al tope se devuelve lo mejor encontrado y **se dice** que la
respuesta no es exhaustiva, en vez de fingir que sí.

### Qué itinerario gana

Primero el que deja **menos tiempo muerto** entre actividades; a igualdad, el que
termina antes. Un turista esperando dos horas en un sitio que no conoce, tras
levantarse a las cinco, cuenta esas dos horas como el paquete entero — y eso es
lo que escribe en la reseña.

### Cuando no se puede, dice qué choca

Decirle a alguien «no se puede» sin enseñarle qué choca no le deja arreglarlo.
Los motivos son concretos y cada uno apunta a una acción distinta:

> «Buggy» no tiene ninguna salida programada.
>
> «Buggy» no sale el 2026-11-10.
>
> «Buggy» no sale a las 14:00 el 2026-11-10.
>
> «Buggy» sale el 2026-11-10 pero no quedan 4 plazas juntas (libres: 2).
>
> «Saona» termina a las 17:00 y «Buggy» sale a las 14:00 el 2026-11-10. Con 30
> minutos de margen no da tiempo.

### Actividades que pueden solaparse, y opcionales

- **Puede solaparse**: un pase de día a un parque no compite con una excursión
  de dos horas dentro de ese mismo parque.
- **Opcional**: si no hay salida para una opcional, el paquete se vende igual y
  se dice que se quedó fuera. Una obligatoria sin salida sí lo tumba.

---

## El día es el de la operadora, no el de UTC

Una salida a las 21:00 de Santo Domingo es del día 10 allí y del 11 en UTC.
Resolver el itinerario en UTC pondría un combo de un día en dos días distintos, y
el manifiesto del autobús tendría a esa gente el día que no es.

---

## Qué manda el navegador, y qué no

El navegador dice **qué paquete** y **qué día**. Nada más.

El servidor resuelve el itinerario, elige las salidas y expande la línea. Si el
navegador mandara las salidas, mandaría también cuáles tienen sitio; si mandara
los componentes, se cobraría a sí mismo **cero** por una excursión suelta.

Y se resuelve **al vender**, no al consultar: entre que se pintó la pantalla y se
pulsó el botón, una salida puede haberse llenado. Si el itinerario ya no se puede
armar, la venta se rechaza **antes de escribir nada** — vender medio paquete y
descubrirlo después deja plazas bloqueadas y a un cliente con la mitad de lo que
compró.

---

## Qué hace la operadora

1. **Crea el producto del paquete** con su precio, y márcalo como paquete en su
   ficha (*Catálogo → Productos*).
2. **Declara el margen** entre actividades. 30 minutos es el defecto.
3. **Añade sus actividades** en *Catálogo → Paquetes → Componentes*: cuál, qué
   día del paquete, en qué orden, y si tiene hora fija.
4. **Prueba el paquete** en *Probar un paquete* antes de ponerlo a la venta.
   Un paquete que se vende sin esa comprobación se descubre roto el día de la
   salida, con el cliente en el lobby.

> Cada actividad necesita **salidas programadas** en los días que le tocan. Un
> paquete cuyas actividades no tienen salidas no se puede armar, y el motivo lo
> dice con ese nombre.

---

## Dónde vive el código

| Qué | Dónde |
|---|---|
| Choques, margen, resolución y alternativas (puro, con pruebas) | `src/lib/bundles.ts` |
| Leer las salidas reales y armar el plan | `src/lib/bundle-service.ts` |
| La expansión al vender y el enlace de los componentes | `src/lib/booking-service.ts` |
| Que cancelar el paquete cancele sus actividades | `src/lib/booking-cancel-service.ts` |
| La consulta del itinerario | `src/app/api/bundles/route.ts` |
| La pantalla | `src/app/dashboard/catalogo/paquetes/page.tsx` |
| El esquema y los disparadores de profundidad | `supabase/migrations/0061_product_bundles.sql` |
| Que un paquete no se contenga a sí mismo | `supabase/tests/product_bundles.test.sql` |
