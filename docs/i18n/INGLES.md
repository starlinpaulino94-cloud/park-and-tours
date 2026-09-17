# El huésped que no habla español

## Qué se traduce, y qué no

Se traduce **lo que ve el huésped**:

1. La página pública de reservas.
2. El voucher que enseña en la puerta.
3. Los mensajes automáticos que recibe (confirmación, recordatorio de la
   víspera, recibo, cancelación, cambio de fecha, propuesta, agradecimiento).

**No se traduce el panel de la operadora**, y es una decisión, no una tarea
pendiente. El equipo de una operadora dominicana trabaja en español. Traducir
cuarenta pantallas de gestión para nadie es exactamente la clase de trabajo que
parece internacionalización y no sirve a ningún usuario. El cliente que no habla
español es el **turista**, y el turista solo ve tres cosas.

Hay una guarda de contrato que lo sostiene: si alguien añade una clave de
traducción fuera de esas tres superficies, la prueba falla. Existe para que
nadie lo empiece «por completar».

---

## El fallo que esto arregla

El mecanismo de idiomas existía desde la ola 3: `resolveTemplate` buscaba la
plantilla del idioma del cliente. Y **no había una sola plantilla que no fuera
española**. Buscaba el inglés, no lo encontraba y caía al español.

Resultado: el turista que reservaba en inglés recibía la confirmación, el
recordatorio de la víspera y el recibo en un idioma que no lee.

El recordatorio de la víspera es el que más importa: lleva **la hora y el lugar
de recogida**. Un huésped que no lo entiende no es un huésped molesto — es un
asiento vacío y una reclamación.

---

## De dónde sale el idioma

Por orden de autoridad, y el orden importa:

1. **Lo que el huésped eligió a mano** (`?lang=en`, con el selector de la
   página). Nada lo discute: si pulsó «English», seguir hablándole en español
   porque su navegador dice otra cosa sería ignorar lo único que dijo de forma
   explícita.
2. **Lo que quedó en su ficha**, de cuando reservó.
3. **Su navegador** (`Accept-Language`). Acierta el 95 % de las veces sin que
   nadie toque nada. Se lee **respetando el peso `q`**, no el orden de
   aparición: un francófono con inglés preferente manda
   `fr-CA,fr;q=0.9,en;q=0.8,es;q=0.5`, y leer por orden le hablaría en español.
4. **Español.**

`en-US`, `EN` y `en_GB` son todos inglés. Sin normalizar, un navegador
estadounidense —que manda `en-US`— se quedaría en español.

### Se decide en el servidor

La página pública se renderiza en el servidor. Detectar el idioma en el
navegador enseñaría la página en español durante el primer pintado, que es justo
el segundo en el que el cliente decide si se queda.

Por eso la página se sirve **por petición y no desde caché**: con caché, la
primera visita fijaría el HTML para todos y a un inglés le tocaría la versión
que pidió un español diez segundos antes.

---

## El idioma sobrevive a la reserva

Cuando el huésped reserva, su idioma queda en su ficha. Los avisos de la
víspera, el recordatorio de saldo y el agradecimiento salen en el idioma en el
que compró — cuando ya no hay navegador del que deducirlo.

Dos detalles que hacen que funcione de verdad:

- **La ficha que ya existía se refresca.** Quien reservó en español el año
  pasado y hoy está reservando en inglés está diciendo en qué idioma quiere que
  le escriban *ahora*.
- **El idioma que manda una OTA no se tira.** OCTO envía `locales` en el
  contacto: ahí es donde el revendedor dice en qué idioma habla su cliente.

---

## El voucher

Lo enseña **él** en la puerta, a veces a alguien que no lo emitió. Un voucher
con las etiquetas en español y el contenido en inglés no es bilingüe, es
confuso.

Van traducidas las etiquetas, los avisos y **también las fechas**: «mié 17 sep»
y «Wed, Sep 17» son la misma fecha, pero un documento que mezcla formatos se lee
dos veces, y en la puerta de un autobús a las siete de la mañana eso importa.

Las condiciones que la operadora configuró (ola 5) se imprimen igual, con la
etiqueta en el idioma del huésped. **El texto de esas condiciones lo escribe la
operadora**: el sistema no lo traduce.

> Si vendes a huéspedes de habla inglesa, escribe también una versión inglesa de
> tus condiciones en *Configuración → Marca*. Es el único texto del voucher que
> el sistema no puede traducir por ti, porque es tuyo.

---

## Las traducciones no son literales

«Te pedimos estar 10 minutos antes» no se dice igual en inglés. Un texto que
suena a traducción automática hace dudar de la operadora entera, así que las
plantillas inglesas están escritas, no convertidas.

---

## Si falta una traducción

**Nunca se enseña la clave del diccionario.** Una pantalla que dice
`engine.submit` parece rota; el español se entiende con el contexto mucho mejor
que eso. El respaldo es siempre el español.

Ese respaldo es lo que hace que una clave que falta **no se note**: cae al
español y nadie lo reporta. Por eso hay dos guardas de contrato que comparan
los diccionarios y las plantillas clave por clave.

---

## Añadir un idioma

1. `SUPPORTED_LOCALES` en `src/lib/i18n.ts`.
2. Los dos diccionarios (`PUBLIC_*` y `DOC_*`) con **todas** las claves — la
   guarda lo exige.
3. Las 12 plantillas de `src/lib/messaging/templates.ts` con ese `language` — la
   guarda también lo exige.

No hace falta tocar nada más: la detección, el selector y el respaldo ya
funcionan para cualquier idioma de la lista.

## Dónde vive el código

| Qué | Dónde |
|---|---|
| Detección, diccionarios y formatos (puro, con pruebas) | `src/lib/i18n.ts` |
| Las plantillas de mensaje | `src/lib/messaging/templates.ts` |
| La página pública | `src/app/reservar/[slug]/page.tsx` y su motor |
| El voucher | `src/lib/pdf/documents.ts` |
| El idioma de una reserva de OTA | `src/lib/octo-service.ts` |
