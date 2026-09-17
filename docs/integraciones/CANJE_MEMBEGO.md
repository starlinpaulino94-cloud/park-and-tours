# Canjear beneficios de MembeGo en el punto de venta

## La regla que ordena todo esto

Está escrita desde la migración 0041, hace dos olas:

> La **elegibilidad** no se copia a propósito: el contrato lo prohíbe porque
> decide dinero y una copia desfasada regala un beneficio ya consumido.

Sigue igual y esta entrega no la toca. Aquí **no hay ninguna tabla que diga si
un cliente tiene derecho a algo**. Se le pregunta a MembeGo en el momento
(`POST /benefits/evaluate`) y se consume contra MembeGo (`POST /redemptions` o
`POST /promotions/redeem`), que es quien decide.

Un cliente que gastó su beneficio hace diez minutos en el car wash de la esquina
se encuentra aquí con un «ya no queda». Eso es lo correcto, y es la razón de que
no haya caché de ningún tipo.

---

## El flujo, y por qué en ese orden

```
  1. Se crea la venta          (el carrito ya no existe; hay una orden real)
  2. Se pregunta a MembeGo     ¿qué puede consumir este cliente AHORA?
  3. El cajero elige           qué beneficio y sobre qué línea
  4. Se CONSUME en MembeGo     ← aquí decide MembeGo, no nosotros
  5. Solo entonces se rebaja   la línea baja y la venta se recalcula
  6. Se cobra                  el importe ya lleva el descuento
```

**El canje va en el diálogo de cobro, no en el carrito.** Un carrito se
abandona; un uso consumido contra un carrito abandonado es un uso que el cliente
perdió sin recibir nada.

**Se consume antes de rebajar.** Al revés parece más amable con el cajero y es
la forma de regalar dinero: si el beneficio ya estaba gastado, la venta saldría
rebajada sin nada que la respalde.

---

## Qué hay que configurar

MembeGo emite credenciales OAuth2 de *client credentials* al dar de alta Park &
Tours como sistema del vertical de excursiones. Van al entorno:

```
MEMBEGO_API_URL=https://www.membego.com
MEMBEGO_CLIENT_ID=mgc_…
MEMBEGO_CLIENT_SECRET=mgs_…
```

> **Pídelas con los dos permisos: `benefits:read` y `benefits:redeem`.** Con
> solo el primero, consultar funciona y **canjear falla en el mostrador, con el
> cliente delante**.

La credencial identifica al **sistema**, no a una empresa. La empresa viaja en
cada llamada (`companyId`, que sale del vínculo de 0041) y MembeGo comprueba que
este sistema esté habilitado para ella. Por eso no hay secretos en la base de
datos.

Sin estas tres variables el canje simplemente no se ofrece; el SSO y los
webhooks siguen funcionando con `MEMBEGO_SECRETO`.

---

## Los dos tipos de beneficio

| | Membresía | Promoción |
|---|---|---|
| Qué es | Un plan con usos incluidos | Una compra promocional del cliente |
| Se canjea en | `POST /redemptions` | `POST /promotions/redeem` |
| Efecto | La línea va **gratis** | Lo que diga la promoción: %, monto o gratis |
| **Reversa por API** | **Sí** | **No** |

Son endpoints distintos porque en MembeGo son cosas distintas. Unificarlos aquí
obligaría a adivinar cuál toca, y adivinar mal consume el beneficio equivocado.

### El efecto en el dinero

- **Gratis** — la línea entera.
- **Porcentaje** — sobre esa línea.
- **Monto fijo** — MembeGo lo manda en **centavos** (2 550 = 25,50). Tratarlo
  como pesos descontaría veinticinco veces de más.

Nunca deja la línea en negativo: un beneficio de 1 000 sobre una línea de 600
descuenta 600.

### Sobre qué línea se aplica

Sobre **una**, no sobre la venta entera. En MembeGo un uso es **un servicio**:
aplicar un «20 %» a una venta de cuatro excursiones consumiría un uso y
descontaría cuatro servicios — regalar tres.

Por defecto se aplica a la **más cara**, que es lo que cualquiera haría a mano y
lo que el cliente espera de «tienes una gratis». El cajero puede cambiarla
cuando la venta tiene más de una línea con importe.

---

## Cuando se anula la venta

Cancelar una reserva **devuelve el beneficio al cliente**: perdió un uso por una
venta que no llegó a existir. Va dentro de la cancelación normal, con todo lo
demás (la plaza, la comisión, el cupo del socio, el almacén).

Dos cosas que conviene saber:

- **Una cancelación nunca se queda a medias por culpa de MembeGo.** Si su API no
  contesta, la reserva se cancela igual y queda un aviso en la auditoría
  (`membego_reversal_failed`).
- **Una promoción no se puede devolver por API.** MembeGo revierte membresías y
  no tiene el equivalente para promociones. Eso **no se disimula**: queda un
  aviso (`membego_reversal_manual`) diciendo que hay que devolverla desde el
  panel de MembeGo. Fingir que se devolvió dejaría al cliente con un uso gastado
  y al sistema diciendo «listo».

---

## Idempotencia: el doble clic

La clave del canje se deriva de la **venta** y del **beneficio**, nunca de un
aleatorio. El doble clic del cajero y el reintento del navegador generan
exactamente la misma clave, así que MembeGo devuelve el primer canje en vez de
consumir un segundo uso.

MembeGo la exige por su lado (`Idempotency-Key`); la restricción única de
`membego_redemption` cierra el hueco antes de salir de aquí.

---

## Qué se guarda, y por qué

`membego_redemption` es el **recibo** del canje, no la elegibilidad. Hace falta
para tres cosas que sin ella no tienen respuesta:

1. **El arqueo.** El cajero cuadra 1 200 y el sistema dice 1 500: la diferencia
   es un beneficio aplicado, y hay que poder señalarlo.
2. **La reversa.** Para devolver el canje hace falta el identificador que
   MembeGo devolvió.
3. **La conciliación.** «Este mes canjeaste 84 beneficios» se contesta con esta
   tabla, no llamando ochenta y cuatro veces a su API.

Los canjes **fallidos** también se guardan, con el código y el `requestId` de
MembeGo. Sin ellos, un «no me aplicó el descuento» no tiene dónde mirarse.

---

## Los errores, y qué hacer con cada uno

MembeGo devuelve un `code` estable — se ramifica sobre él, nunca sobre el texto.
El código llega hasta la pantalla del cajero **sin convertirse en un 500
genérico**, porque la diferencia importa: con «no te quedan usos» se cobra
completo; con «no hay conexión» se espera un minuto.

| Código | Qué pasó | Qué hacer |
|---|---|---|
| `BENEFIT_NOT_ELIGIBLE` | Existe pero no se puede usar ahora | Cobrar completo. La lista se recarga sola |
| `REDEMPTION_CONFLICT` | Alguien se adelantó | Volver a consultar y decidir |
| `COMPANY_NOT_ENTITLED` | Este sistema no está habilitado para esa empresa | Escalar: es configuración de MembeGo |
| `INSUFFICIENT_SCOPE` | La credencial no pide `benefits:redeem` | Escalar: hay que reemitirla |
| `RATE_LIMITED` / `INTERNAL_ERROR` | Problema pasajero | Se reintenta una vez solo; después, esperar |

El token caducado se renueva solo y se reintenta una vez: sin eso, el primer
canje después de diez minutos de calma fallaría siempre.

---

## Deuda conocida

MembeGo publica su vocabulario en un paquete propio (`@membego/contracts`)
precisamente para que los satélites no lo copien — «copiar funciona el primer
día y falla el tercer mes». **Ese paquete todavía no está publicado en npm**, así
que `src/lib/membego-benefits.ts` lleva la copia.

**El día que se publique, hay que sustituirla por la dependencia.** Mientras
tanto, una guarda de contrato comprueba que los códigos que este código sabe
distinguir sigan estando.

---

## Qué le toca a la operadora

- [ ] Pedirle a MembeGo las credenciales del sistema con los dos permisos.
- [ ] Ponerlas en el entorno (`MEMBEGO_CLIENT_ID`, `MEMBEGO_CLIENT_SECRET`).
- [ ] Comprobar que el vínculo de la empresa está activo en
      *Administración → Integraciones*.
- [ ] Probar una venta con un cliente que tenga membresía activa, y después
      anularla para ver que el uso vuelve.

## Dónde vive el código

| Qué | Dónde |
|---|---|
| Las reglas (puro, con pruebas) | `src/lib/membego-benefits.ts` |
| El cliente HTTP de la API de plataforma | `src/lib/membego-platform.ts` |
| El canje y la reversa contra la base | `src/lib/membego-redemption-service.ts` |
| Consultar y canjear | `src/app/api/membego/{benefits,redeem}` |
| El mostrador | `src/app/dashboard/pos/_components/membego-benefits.tsx` |
| El esquema | `supabase/migrations/0057_membego_redemptions.sql` |
| La devolución al cancelar | `src/lib/booking-cancel-service.ts` |
