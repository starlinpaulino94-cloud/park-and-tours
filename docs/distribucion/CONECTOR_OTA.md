# Conectar la operadora a las OTA (estándar OCTO)

## Por qué no hay «un conector de Viator»

La hoja de ruta pedía empezar por un conector, Viator o GetYourGuide. Al
investigarlo aparece que ese no es el trabajo.

Las OTA de excursiones dejaron de integrarse una a una hace años. Existe
**OCTO** — *Open Connectivity for Tours, Activities and Attractions* — una
especificación **abierta** que define los mismos endpoints, los mismos campos y
los mismos estados para todos, y que consumen GetYourGuide, Viator, Klook y las
plataformas de conectividad que revenden a decenas más.

La diferencia práctica:

| Un cliente de Viator | Hablar OCTO |
|---|---|
| Credenciales de Viator, revisión de Viator, código que solo sirve para Viator | Una dirección que vale para cualquiera |
| Al día siguiente, otro para GetYourGuide | El trabajo se hace una vez |
| Caduca cuando la OTA cambia su API privada | La especificación es pública y versionada |

Y hay una razón de dirección que decide el diseño: **en este negocio la
operadora es el proveedor, no el que compra.** Quien tiene el inventario es
ella. Por eso lo que se construyó es el **lado proveedor** del estándar: los
revendedores consultan nuestro catálogo, nuestra disponibilidad y crean reservas
contra nosotros.

---

## Qué hay que hacer para conectar una OTA

1. **Crear una llave de API** con alcance de **escritura** en
   *Administración → Llaves de API*, y asignarla al **socio** que corresponde a
   esa OTA (`partner`). Esto no es un detalle: el socio es lo que ata la reserva
   a su comisión, a su cupo contratado y a su liquidación.
2. **Entregarle dos cosas** a la OTA:
   - la dirección: `https://TU-DOMINIO/api/octo/v1`
   - la llave, en la cabecera `Authorization: Bearer <llave>`
3. **Esperar su certificación.** Toda OTA prueba la conexión contra el sistema
   real antes de abrir la venta. Esas reservas llegan marcadas como prueba y no
   se cuentan en *Distribución → Canales externos*.

No hace falta programar nada más. Quien hable OCTO se conecta solo.

---

## El mapeo: qué es cada cosa del estándar aquí

| OCTO | Aquí |
|---|---|
| `Supplier` | La empresa |
| `Product` | Un producto publicado |
| `Option` | Una modalidad del producto (VIP, privado, grupo), más una opción `default` |
| `Unit` | `adult`, `child`, `infant` |
| `Availability` | Una salida (`departure`), y su `id` es el `availabilityId` |
| `Booking` | Una reserva, con su venta de una línea |
| El revendedor | Un socio (`partner`) con su llave |

Dos decisiones que conviene entender:

- **Adulto, niño e infante son unidades, no opciones.** Es lo que la reserva
  guarda de verdad. Ofrecerlas como opción dejaría pedir «opción: niño, unidad:
  adulto», que no significa nada y que el motor de precios resolvería en
  silencio.
- **El infante no ocupa plaza.** Va en brazos y no cuenta contra el cupo, lo que
  además evita que una madre con su bebé no quepa en una salida con una plaza
  libre.

---

## Qué ve el revendedor y qué no

Ve **solo los productos publicados**, con la misma ficha que la página pública.
El costo, el proveedor y las notas internas son del negocio de la operadora.

**No decide el precio, ni la moneda, ni el cupo, ni la empresa.** Se aceptan los
datos que solo él conoce —quién viaja, cuántos, qué día— y todo lo que tiene
valor económico lo calcula el servidor con el mismo motor que el mostrador
(tarifa del socio, temporada, promoción, tramos por cantidad).

### Cerrarle un producto a un revendedor concreto

No hay un interruptor «vender en OTA» por producto: sería una casilla que nadie
marcaría y el revendedor recibiría un catálogo vacío el día del estreno.

Lo que se usa es el **cupo** (*Distribución → Allotments*):

- `closed` — ese socio no vende ese producto.
- `guaranteed` — plazas apartadas para él, y no puede pasar de ahí.
- `free_sale` — vende hasta donde llegue la capacidad de la salida.

El conector respeta el cupo igual que el portal B2B, porque pasa por el mismo
motor de ventas.

---

## El ciclo de una reserva

```
  reserve  ──►  ON_HOLD  ──► confirm ──►  CONFIRMED  ──► embarque ──► REDEEMED
                   │                          │
                   │ vence el plazo           │ cancel
                   ▼                          ▼
                EXPIRED                    CANCELLED
```

### `ON_HOLD`: la retención

El revendedor reserva **sin pagar** y la plaza queda apartada unos minutos
mientras su cliente termina de pagar en su web. Es el comportamiento normal del
estándar.

El plazo lo pide él (`expirationMinutes`) y **la operadora pone el techo**:
`organizations.octo_max_hold_minutes`. Sin techo, un revendedor puede pedir una
semana, que sería regalar el inventario.

> **Configúralo.** Sin valor, el tope es de 24 horas. Para una OTA, entre 20 y
> 60 minutos es lo razonable.

### `EXPIRED` no es `CANCELLED`

Es la distinción que más importa en la liquidación:

- **Vencida** — un carrito abandonado en la web del revendedor. No hay nada que
  atender.
- **Cancelada** — hay un cliente que se cayó, y puede haber reembolso.

Se enseñan en columnas distintas en *Canales externos* a propósito. Si la tasa
de vencidas es alta, no es mala suerte: el plazo de retención que se le concedió
a ese revendedor es demasiado corto para su pasarela de pago, y se arregla con
una conversación.

### Soltar la plaza a tiempo

Una retención de OTA dura minutos. El barrido general de retenciones corre una
vez al día, y esperar a él dejaría la plaza de un carrito abandonado a las nueve
de la mañana bloqueada hasta la noche: la salida diría «completo» con asientos
que nadie compró.

Por eso se sueltan en dos sitios:

- **Al preguntar por disponibilidad**, de forma oportunista. Quien pregunta por
  plazas es exactamente quien necesita que estén al día.
- **Cada hora**, con el cron `/api/cron/octo-holds`, que cubre a la operadora
  que no tuvo tráfico esa mañana.

### Cancelar

Una cancelación desde una OTA hace **exactamente lo mismo** que una de
mostrador: aplica la política de reembolso, suelta la plaza, anula las
comisiones, cancela el devengo del proveedor, libera las existencias apartadas,
devuelve las plazas al cupo del socio, cancela las recogidas, invalida el
voucher, registra el reembolso en caja y en el libro, y avisa al cliente y al
gerente.

**El `force` del estándar no se obedece.** OCTO admite que el revendedor pida
saltarse el corte de cancelación; hacerle caso sería dejarle decidir desde su
servidor cuánto se le devuelve. La cancelación se registra igual; **lo que manda
la política es cuánto se reembolsa.**

> **Define la política de cancelación de cada producto.** Sin política, se le
> publica al revendedor un corte de 24 horas por defecto, que es el supuesto de
> la industria — pero es un supuesto, no tu acuerdo.

---

## Endpoints

Todos bajo `/api/octo/v1`, con `Authorization: Bearer <llave>`.

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/supplier` | Quién es la operadora. Es el «ping» de la conexión |
| GET | `/capabilities` | Qué extensiones se soportan |
| GET | `/products` | El catálogo publicado |
| GET | `/products/{id}` | Un producto con sus opciones y unidades |
| POST | `/availability` | Fechas y horas con plaza |
| POST | `/availability/calendar` | Un día por fila, para pintar el calendario |
| GET | `/bookings` | Buscar por referencia (la conciliación) |
| POST | `/bookings` | Reservar (retener) |
| GET | `/bookings/{uuid}` | El estado de una reserva |
| PATCH | `/bookings/{uuid}` | Prorrogar la retención |
| POST | `/bookings/{uuid}/confirm` | Confirmar |
| POST | `/bookings/{uuid}/cancel` | Cancelar |
| POST | `/bookings/{uuid}/extend` | Prorrogar la retención |

### Capacidades soportadas

`octo/content` (textos e imágenes), `octo/pricing` (precios) y `octo/pickups`
(recogida en hotel). Se piden en la cabecera `Octo-Capabilities`.

La lista corta es una decisión, no una carencia disimulada: anunciar una
capacidad que no se cumple hace que el revendedor deje de mandar los campos que
compensaban su ausencia, y todo falla más tarde y en peor sitio. Lo que pida de
más se ignora en silencio, como manda el estándar.

### Idempotencia

El `uuid` de la reserva lo pone el revendedor y **repetirlo devuelve la misma
reserva**, no otra. Se comprueba antes de escribir nada.

Sin eso, un reintento de una conexión caída a medio camino apartaría las mismas
tres plazas dos veces, y la operadora lo descubriría con un asiento de sobra en
la guagua.

### Precios

Van en la **unidad mínima de la moneda**: 25,50 USD viajan como `2550`. Es el
error clásico de estas integraciones y el más caro — mandar `25.5` vende la
excursión por veinticinco centavos.

### Errores

Se devuelven con el vocabulario del estándar, porque el revendedor ramifica
sobre él:

| Código | Significa |
|---|---|
| `INVALID_PRODUCT_ID` / `INVALID_OPTION_ID` / `INVALID_UNIT_ID` | Ese identificador no existe o no está a la venta |
| `INVALID_AVAILABILITY_ID` | Esa fecha no existe, o falta y el producto se vende por fecha |
| `INVALID_BOOKING_UUID` | No hay reserva con ese uuid |
| `UNPROCESSABLE_ENTITY` | La petición está bien; lo que no hay es plaza, o el estado no admite esa transición |
| `FORBIDDEN` | La llave no alcanza, o la cuenta de la operadora no admite reservas |
| `UNAUTHORIZED` | Falta la llave |

El cupo agotado del socio y la sobreventa llegan como `UNPROCESSABLE_ENTITY`: la
petición era correcta, lo que falta es inventario. Devolver `BAD_REQUEST` haría
que el revendedor buscara un error en su JSON que no existe.

---

## La zona horaria: configúrala

Las horas se publican en **hora local del producto con su desplazamiento**
(`2026-11-17T09:00:00-04:00`), que es lo que el estándar exige.

Sale de `organizations.timezone`. Si está vacía se usa `America/Santo_Domingo`.

> **Revísala si operas fuera de RD.** Sin el desplazamiento correcto, el
> revendedor interpreta la hora en su zona y le enseña al cliente una salida a
> las tres de la mañana.

---

## Qué le toca a la operadora

- [ ] Poner la zona horaria de la empresa.
- [ ] Definir la política de cancelación de cada producto que se vaya a vender
      fuera.
- [ ] Fijar el techo de retención (`octo_max_hold_minutes`).
- [ ] Crear el socio y su llave de escritura para cada OTA.
- [ ] Cargar el cupo de cada OTA en *Allotments* (o dejarlo en venta libre a
      conciencia).
- [ ] Publicar los productos que se van a vender fuera.
- [ ] Acompañar la certificación de la OTA y revisar después
      *Distribución → Canales externos*.

## Dónde vive el código

| Qué | Dónde |
|---|---|
| Las reglas del estándar (puro, con pruebas) | `src/lib/octo.ts` |
| La base y el motor de ventas | `src/lib/octo-service.ts` |
| Autenticación y traducción de errores | `src/lib/octo-http.ts` |
| Los endpoints | `src/app/api/octo/v1/**` |
| El barrido de retenciones | `src/app/api/cron/octo-holds/route.ts` |
| La pantalla | `src/app/dashboard/distribucion/canales/page.tsx` |
| El esquema | `supabase/migrations/0056_octo_connector.sql` |
| La cancelación compartida con el mostrador | `src/lib/booking-cancel-service.ts` |
