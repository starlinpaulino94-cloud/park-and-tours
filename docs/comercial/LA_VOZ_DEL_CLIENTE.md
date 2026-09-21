# La voz del cliente

Qué pasa después de que el pasajero se baja de la guagua.

---

## Lo que pasaba antes

Nada. De las 114 tablas del sistema no había ninguna de opinión: no se sabía
cómo le fue a nadie, qué guía deja clientes contentos y qué guía deja quejas, ni
se le pedía la reseña en el único momento en que la escribe, que es el mismo día.

Y había una plantilla, `post_tour_thanks`, escrita hacía olas, con su desfase de
cuatro horas y su disparador documentado —«4 horas después de terminar»—. **No
la encolaba nadie.** Era el mismo caso que `departure.waitlist_pax` antes de la
ola 11: una promesa escrita que ninguna línea de código cumplía.

Peor todavía: su texto decía *«contéstanos a este mismo correo»*. Aunque se
hubiera mandado, la respuesta habría caído en una bandeja de entrada. Nadie la
tabula, nadie la atribuye a un guía y nadie la convierte en una reseña pública.

> Preguntar sin medir es no preguntar.

---

## El recorrido completo

```
  la salida termina
         │  + duración del producto + 4 h
         ▼
  el barrido crea UNA FILA POR RESERVA
         │
         ├── no se pregunta ──► queda la fila con el MOTIVO (ota, canceló,
         │                       no vino, sin contacto, fatiga, se dio de baja)
         │
         └── se pregunta ─────► correo o WhatsApp con un enlace
                                       │
                                       ▼
                              una pregunta: 0 a 10
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
           9 o 10                    7 u 8                  0 a 6
        reseña pública              gracias            caso + aviso al
       (por nuestra ruta)                               equipo: LLAMAR
```

---

## Las decisiones, y por qué

### Una fila por reserva, aunque no se pregunte

Sin ella el panel diría «12 % de respuesta» sin distinguir entre **no
contestaron** y **no se les preguntó**, que son dos problemas distintos con dos
arreglos distintos. Una tasa de respuesta que miente es peor que no tenerla.

Por eso la tasa se calcula sobre las **preguntadas**, no sobre el total: meter
en el denominador a los clientes de OTA —a los que por contrato no se les
escribe— haría que una operadora que vende bien por OTA viera caer su «tasa de
respuesta» cuanto mejor le fuera.

### Al cliente de una OTA no se le escribe

No es una limitación técnica: es el contrato. El revendedor es el dueño de esa
relación, el correo que cede suele ser un alias suyo, y escribirle directamente
al pasajero para pedirle una reseña es la forma más rápida de que una OTA corte
el canal.

Queda la fila con `skip_reason = 'ota'` para que la operadora vea **cuánta de su
opinión vive fuera de su alcance**. Es un dato de negocio, no un hueco.

### El 7 y el 8 no son aprobados

Son pasivos. Un pasivo vuelve si no encuentra nada mejor y no te defiende
delante de nadie. Contarlo como contento es la forma más común de que un panel
diga que todo va bien mientras la reputación baja. Por eso el NPS no los suma ni
a favor ni en contra.

Y por eso se usa NPS y no una media de estrellas: diez pasajeros que ponen 7 y
diez que ponen 3 dan la misma media que veinte que ponen 5, y no es el mismo
negocio — en el primer caso hay diez personas contándolo mal por ahí.

### A un detractor no se le pide una reseña pública

Se le pide que cuente qué pasó, se le abre un **caso de huésped** y se avisa a
operaciones para que alguien lo llame **hoy**. Mandar a un detractor a Google es
pagarle el altavoz.

Y la bifurcación se decide en el servidor, a partir de la nota ya guardada. Si
la decidiera la pantalla, cualquiera pediría la dirección de la reseña pública
poniéndose un 10 en el inspector.

### El guía se congela al preguntar

La asignación de una salida cambia —alguien se enferma, se reasigna—, así que
resolver el guía al mirar el panel contaría la nota de hoy al guía de mañana.

### El enlace caduca, y el token es único en toda la tabla

Un enlace sin sesión que vale para siempre es una superficie abierta en un correo
que cualquiera reenvía: treinta días sobra para opinar de un día concreto.

Y el token es único globalmente y no por empresa porque **la página pública no
sabe de qué operadora es el cliente**: resuelve por el token a secas. Si dos
empresas pudieran repetirlo, el pasajero de una vería —y contestaría— la
encuesta de la otra. Hay una prueba SQL que lo comprueba.

### La baja es del cliente, y no silencia el viaje

Se da de baja desde el pie de la propia encuesta, en un clic, sin cuenta y sin
llamar a nadie. Una baja que obliga a escribir un correo no es una baja: es un
formulario para que el cliente desista.

Silencia las **encuestas** y no los mensajes de servicio: el recordatorio de la
víspera lleva la hora y el lugar de recogida, y es parte de lo que compró. Por
eso la columna se llama `survey_opt_out` y no `no_email`.

### El barrido mira tres días atrás

Sin ese suelo, el día que una operadora activa el módulo el sistema le escribiría
a **todos** los pasajeros de los últimos dos años preguntándoles por una
excursión de 2024 — que es la forma más rápida de acabar en las listas de spam
el mismo día del estreno.

---

## Lo que NO lleva, a propósito

- **No hay cuestionario configurable.** Una encuesta que se puede alargar se
  alarga, y una encuesta larga no se contesta: la tasa de respuesta se hunde y
  con ella el dato.
- **No hay alta manual de opiniones en el panel.** Un botón de «nueva opinión»
  permitiría a la operadora escribir la nota de sus propios clientes, que es
  exactamente lo que hace que un NPS no valga nada.
- **No se esconden los grupos con pocas respuestas.** Se enseñan con su
  recuento al lado: quién decide si tres respuestas bastan para hablar de un
  guía es quien mira el panel. Lo que no se hace es inventarse un número cuando
  no hay ninguna — sin respuestas el NPS es «—», nunca 0.

---

## Dónde corre

El barrido va dentro del cron diario de mensajería (`/api/cron/dispatch-messages`),
**antes** de despachar la cola, para que la encuesta salga en la misma pasada y
no al día siguiente. Ahí mismo se cierran las que caducaron: una encuesta
`pending` de hace tres meses cuenta como «estamos esperando», y con suficientes
de esas la tasa de respuesta del mes pasado sigue cambiando.

---

## Dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| Las reglas (puras, sin base) | `src/lib/voice.ts` |
| El servicio | `src/lib/voice-service.ts` |
| La encuesta del pasajero | `/opinar/[token]` |
| El salto a la reseña pública | `/opinar/[token]/resena` |
| El panel de la operadora | `/dashboard/clientes/opiniones` |
| La tabla | `guest_survey` (migración 0067) |
| Dónde se configura la reseña pública | `organizations.review_url` |
