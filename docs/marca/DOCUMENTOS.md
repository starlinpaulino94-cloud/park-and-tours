# Tu marca en los documentos

El voucher, la cotización y la factura son lo único que el cliente se lleva a
casa. Esto es lo que decide cómo salen.

---

## 1. Un fallo que conviene entender

La pantalla de Configuración pedía WhatsApp, logo, dirección, ciudad y color de
marca **desde el primer día**. La API los aceptaba. El código los declaraba. Y
ninguna de esas columnas existía en la base de datos.

No era el fallo silencioso de perder un campo: **PostgREST rechaza el UPDATE
entero** cuando una sola columna del payload no existe. En cuanto alguien
escribía su WhatsApp o pegaba la URL de su logo, el guardado fallaba completo y
se perdían también el nombre, el RNC y todo lo demás del formulario.

Si alguna vez intentaste poner tu logo y «no se guardó nada», era esto.

La migración `0055` crea las columnas, y hay una prueba que compara la lista de
campos editables contra el esquema real para que no vuelva a pasar.

---

## 2. Qué se configura

**Configuración → Empresa → Tu marca en los documentos.**

| Campo | Dónde sale |
|---|---|
| **Logo** | cabecera de cada hoja de cada documento, y la página pública |
| **Color de marca** | títulos, líneas de acento y la página pública |
| **Pie legal** | al pie de cada hoja, en todos los documentos |
| **Condiciones del voucher** | al final del voucher |
| **Nota legal de la factura** | al final de la factura |

Los datos de contacto (teléfono, WhatsApp, correo, dirección, ciudad) y el
**RNC** salen en la cabecera de todos los documentos.

### La vista previa

Un color se elige mirándolo. La pantalla enseña la cabecera tal y como saldrá en
el voucher —logo, nombre, razón social, contacto, RNC— antes de que entregues mil
documentos.

---

## 3. El logo: PNG o JPG, y punto

El formato PDF **no sabe incrustar SVG ni WebP**. Si el sistema los aceptara, tu
logo se vería en pantalla y no en el voucher, y te enterarías por un cliente. Por
eso la subida los rechaza y te dice por qué.

Otros límites, con motivo:

- **2 MB como máximo.** Un logo es un logo; bajarse 20 MB para pintar una
  cabecera de 40 puntos es tirar memoria del servidor.
- **4 segundos para descargarlo.** Si el almacenamiento está lento, el documento
  sale **sin logo** en vez de dejar al cliente mirando una pantalla girando.
- **Se incrusta una sola vez** aunque el documento tenga diez hojas.

Si el logo no se puede traer, el documento sale con el nombre en texto — que es
como salía antes de todo esto. **Nunca se queda nadie sin voucher por el logo.**

---

## 4. El color: se elige, pero se avisa

El color se guarda validado como `#rrggbb`. Si escribes «azul», la pantalla te lo
dice en vez de fallar sin explicación, y la base tiene su propia comprobación
como último cierre.

**El aviso de contraste importa.** Si eliges un amarillo corporativo, el texto
blanco encima deja de leerse. El sistema calcula la luminancia real —no el
promedio de los canales, que da por oscuro un verde lima— y elige el texto que
mejor se lee. Si ni el claro ni el oscuro llegan al mínimo legible, te avisa.

El documento se imprime igual: es tu marca y la decisión es tuya. Pero la tomas
sabiendo.

---

## 5. Lo que manda sobre lo que

Las condiciones son una **plantilla**, no una norma:

```
condiciones de la reserva concreta   →  ganan
condiciones del voucher (plantilla)  →  se usan cuando la reserva no trae las suyas
```

Lo pactado en una venta concreta gana siempre. Si a un grupo le prometiste una
cancelación distinta, eso es lo que sale en su voucher.

Igual con el nombre: si no hay nombre comercial se usa la razón social, y si no
hay ninguno de los dos **se deja en blanco**. El sistema no inventa un «Mi
empresa» que acabaría impreso en un voucher de verdad.

---

## 6. Dónde llega la marca

- **Los seis documentos**: voucher, cotización, factura y nota de crédito,
  manifiesto, arqueo de caja y estado de cuenta de proveedor.
- **La página pública de reservas** (`/reservar/tu-slug`): logo y color.

---

## 7. Para dejarlo completo

La propia pantalla lista lo que falta. Por orden de lo que más se nota:

1. **Nombre y RNC** — sin RNC, las facturas no cumplen con la DGII.
2. **Logo** en PNG o JPG.
3. **Teléfono o correo** — el cliente tiene que saber a quién llamar.
4. **Dirección** — una factura sin ella queda incompleta.
5. **Pie legal** — el registro mercantil o la leyenda que te exijan.
6. **Color**, si tienes uno de marca.
