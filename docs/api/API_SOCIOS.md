# API de socios

Para que otro sistema —la web de una agencia, un tour center con software
propio, un conector de OTA— consulte el catálogo y cree reservas.

Todo lo demás del sistema exige una sesión de navegador. Esto no: se autentica
con una **llave** que emite la operadora desde *Administración → Integraciones*.

## La llave

```
pt_live_a1b2c3d4.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
└──┬───┘ └──┬───┘ └────────────────────┬───────────────────┘
 entorno  prefijo                    secreto
```

- Se manda en cada petición: `Authorization: Bearer pt_live_…`
  (también se acepta `X-API-Key`).
- **El secreto se muestra una sola vez.** El sistema guarda solo su huella; si
  se pierde, se emite otra llave y se revoca la anterior.
- Dos alcances: **solo consultar** o **consultar y crear reservas**. Pide el
  mínimo que necesites: una llave de lectura filtrada no puede vender.
- Límite: 600 peticiones por minuto **por llave**.

## Endpoints

Todos devuelven `{ "data": … }` y, en caso de error,
`{ "error": { "message": …, "status": … } }`.

### `GET /api/v1/products`

El catálogo publicado. Devuelve lo mismo que la página pública de la operadora:
nombre, descripción, duración, idiomas, precio «desde» y moneda. No incluye
costos ni proveedores.

### `GET /api/v1/availability?product=<id>`

Las salidas futuras **con plaza**. `seatsLeft` es `null` cuando esa salida no
lleva control de cupo — es «no aplica», nunca «cero».

### `POST /api/v1/bookings`

Crea la reserva. Requiere alcance de escritura y **la cabecera
`Idempotency-Key`**.

```http
POST /api/v1/bookings
Authorization: Bearer pt_live_…
Idempotency-Key: 8f2a-…-reserva-1024
Content-Type: application/json

{
  "productId": "…",
  "departureId": "…",
  "adults": 2,
  "children": 1,
  "name": "Ana Pérez",
  "email": "ana@correo.com",
  "phone": "8095550101",
  "hotel": "Riu Bávaro",
  "room": "1204",
  "notes": "Vegetariana",
  "language": "es"
}
```

Respuesta `201`:

```json
{ "data": { "reference": "BK-1024", "order": "ORD-512", "product": "Isla Saona",
            "date": "2026-09-30T08:00:00Z", "total": 267.00, "currency": "usd",
            "status": "pending_payment" } }
```

**Sobre la idempotencia.** Manda un identificador único por reserva y repítelo
si reintentas. Si la petición vuelve a llegar con la misma clave, la respuesta
es la reserva que ya se creó, con `"repeated": true`, en vez de una segunda
reserva. Sin eso, una conexión que se corta a medio camino deja dos plazas
ocupadas por la misma persona — y eso se descubre en la puerta del bus.

**Lo que el socio no decide.** El precio, el cupo, la moneda y el estado los
calcula el servidor. Mandarlos en el cuerpo no hace nada: se ignoran.

## Errores

| Código | Qué significa |
| --- | --- |
| 401 | Llave ausente, mal formada, desconocida o revocada. |
| 403 | La llave es válida pero es de solo lectura. |
| 400 | Falta `Idempotency-Key`, o los datos de la reserva están incompletos. |
| 402 | La cuenta de la operadora no admite reservas nuevas ahora mismo. |
| 404 | El producto no está publicado. |
| 429 | Demasiadas peticiones con esta llave. |

Un 401 no distingue entre «no existe» y «no es válida», a propósito: esa
diferencia solo le sirve a quien está probando llaves.
