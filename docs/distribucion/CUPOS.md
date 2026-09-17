# Cupos por socio: contratar, vender y liberar

Cómo funciona un contrato de plazas con una agencia, qué hace el sistema solo y
qué decisiones son tuyas.

---

## 1. El problema que resuelve

`allotment` existía desde el principio con todo lo que hace falta —plazas,
plazas usadas, días de liberación, tipo de cupo— y **nadie la leía**. Era una
pantalla de alta que guardaba filas sin efecto.

Lo que pasaba de verdad: le prometías 10 plazas garantizadas a una agencia por
contrato, y el sistema le dejaba vender las 40 de la salida o ninguna, según la
suerte. El cupo se llevaba en un Excel y se revisaba por WhatsApp la mañana de
la salida.

Ahora el cupo **acota la venta** y **se libera solo**.

---

## 2. Los cuatro tipos, y qué significan

| Tipo | El socio vende… | ¿Aparta plazas? |
|---|---|---|
| **Venta libre** (`free_sale`) | hasta donde llegue la capacidad de la salida | no |
| **Garantizado** (`guaranteed`) | **hasta su número**, y nadie más lo toca | **sí** |
| **A petición** (`on_request`) | sí, pero cada reserva necesita confirmación | no |
| **Cerrado** (`closed`) | no vende | — |

Solo el **garantizado** tiene un número propio. Los demás venden contra la
capacidad de la salida, que es lo correcto: un contrato de venta libre no es un
límite, es una relación.

---

## 3. El ciclo

```
vender     →  plazas usadas += n     (el socio consume su cupo)
cancelar   →  plazas usadas -= n     (vuelven a ser suyas)
liberar    →  plazas liberadas += n  (dejan de ser suyas: van a venta libre)
```

**Lo que le queda = contratadas − vendidas − liberadas.**

Las liberadas ya no son suyas: volvieron a la venta libre porque no las vendió a
tiempo. Contarlas como disponibles prometería dos veces la misma plaza — una al
socio y otra a quien la compró después.

### Cancelar devuelve a SU cupo

La reserva guarda **de qué cupo salió y cuántas plazas tomó**. Si el contrato
cambió de temporada entre la venta y la cancelación, devolverlas al cupo vigente
le regalaría plazas a la temporada nueva.

---

## 4. La liberación automática

`release_days` es el corazón del acuerdo: *«te guardo 10 plazas hasta 3 días
antes; lo que no hayas vendido vuelve a la venta libre»*. Existía en la tabla y
**no liberaba nunca**: un cupo garantizado que el socio no usaba se quedaba
bloqueado hasta la salida, y la operadora decía «completo» con diez asientos
vacíos que nadie iba a ocupar.

El barrido corre **todos los días a las 3:00 UTC** y libera lo no vendido de los
cupos garantizados atados a una salida concreta.

Tres cosas que importan:

- **La cuenta es por días de calendario, no por horas.** El contrato dice «tres
  días antes» y eso significa una fecha. Medido en horas, `release_days: 0`
  —«libéralas el día de la salida»— no liberaría hasta que el autobús ya hubiera
  arrancado.
- **Sin `release_days` no se libera nunca.** Es un cupo en firme hasta el final,
  y hay contratos así. Déjalo vacío a propósito, no por olvido.
- **Correr dos veces no libera dos veces.** Lo liberable se calcula como
  contratadas menos vendidas menos liberadas, así que un reintento no encuentra
  nada.

Cuando se libera, salta un aviso en la campana: son plazas que alguien puede
vender **hoy**.

> Un cupo de producto sin salida concreta **no se libera**: no hay fecha contra
> la que contar los días, y liberarlo «por si acaso» le quitaría plazas a un
> contrato que sigue vigente.

---

## 5. La matriz

**Distribución → Matriz de cupo.**

La pantalla de allotments es la lista de contratos y responde a «¿qué acuerdos
tengo?». La pregunta que te haces diez veces al día es otra: **«¿qué le queda a
esta agencia la semana que viene?»**. Eso se mira en una rejilla, día a día.

Ver las liberadas aparte de las vendidas es lo que permite la conversación del
viernes: *«te liberé seis del sábado, ¿las quieres de vuelta o las vendo?»*.

«Libre» en la columna de restantes significa que ese día el socio no tiene cupo
apartado: vende contra la capacidad de la salida.

---

## 6. Qué acota y qué no

El cupo **solo acota al socio**. Tu vendedor sigue vendiendo contra la capacidad
de la salida: el cupo es un acuerdo con la agencia, no un límite de tu negocio.

Y el orden importa: primero se comprueba que **quepan** (capacidad), después que
el **contrato lo permita** (cupo). Si no caben, el motivo que se da es ese — no
tiene sentido decirle a una agencia que agotó su cupo cuando el problema es que
el autobús está lleno.

---

## 7. Para empezar

1. Da de alta el socio (Distribución → Tour centers).
2. Créale el allotment: tipo, plazas y **días de liberación**. Si le prometiste
   plazas en firme, deja los días vacíos.
3. Acota la **temporada** y los **días de la semana** si el contrato los tiene.
   Una lista de días vacía significa *todos los días*, no *ninguno*.
4. Un cupo atado a **una salida concreta** gana al que está atado al producto: es
   más específico, y para eso existe.
5. Revisa la matriz antes de la reunión semanal con cada agencia.
