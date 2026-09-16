# Nómina y personal en la República Dominicana

Qué calcula el sistema, con qué números, y **dónde se cambian** cuando la TSS o
la DGII los actualicen. Este documento es para quien administra la empresa, no
para quien programa: si algo de aquí no cuadra con tu realidad, se cambia en el
sitio que se indica y en ningún otro.

---

## 1. El recorrido completo

```
Certificación vigente  →  Turno  →  Marcaje  →  Horas aprobadas  →  Corrida  →  Archivo al contador
```

Cada flecha es una puerta, no un adorno:

| Paso | Dónde | Qué impide |
|---|---|---|
| Certificación | Equipo → Certificaciones | Asignar a alguien con una acreditación obligatoria vencida |
| Turno | Equipo → Turnos | Publicar un cuadrante con solapes o con gente bloqueada |
| Marcaje | Equipo → Asistencia | Dos marcajes de la misma persona el mismo día |
| Aprobación | Equipo → Asistencia | Que entren en nómina horas que nadie revisó |
| Corrida | Equipo → Nómina | Pagar dos veces el mismo día de trabajo |

---

## 2. La jornada y las horas extra

Según el Código de Trabajo dominicano:

- **Jornada ordinaria**: 8 horas al día y **44 a la semana** (art. 147).
- **Hora extraordinaria**: recargo del **35 %** sobre la hora normal, hasta las
  **68 horas semanales** (art. 203).
- **Por encima de 68 h/semana**: recargo del **100 %**.

El reparto es **semanal**, no diario. Seis jornadas de 8 horas son 48: las
cuatro últimas son extra aunque ningún día haya pasado de 8. Un sistema que solo
mirara el día pagaría esas cuatro horas a tarifa normal.

**Dónde se cambia**: `src/lib/hr.ts` → `DAILY_REGULAR_HOURS`,
`WEEKLY_REGULAR_HOURS`, `WEEKLY_OVERTIME_CAP`, `OVERTIME_RATE`,
`EXTRA_OVERTIME_RATE`.

### La tarifa por hora de un asalariado

Un sueldo mensual se divide entre **190,67 horas** (52 semanas × 44 h ÷ 12
meses), que es el divisor de la práctica dominicana. Dividir entre «30 días × 8
horas» daría una hora más barata y pagaría de menos el tiempo extra.

Si la ficha de la persona trae una **tarifa por hora explícita**, esa gana
siempre. Quien cobra por día se convierte con la jornada de 8 horas.

---

## 3. Seguridad Social (TSS)

Se descuenta **solo a quien cotiza**: la ficha de personal tiene la casilla
«Aplica Seguridad Social». El guía externo que factura sus servicios **no** es
empleado y no se le retiene nada.

| Concepto | Empleado | Empleador |
|---|---|---|
| SFS (salud) | 3,041 % | 7,09 % |
| AFP (pensiones) | 2,87 % | 7,10 % |
| Riesgos laborales | — | 1,20 % |

Los porcentajes se **copian a cada corrida** en el momento de crearla. Cuando la
TSS los cambie, lo pagado el año pasado seguirá explicándose con los de
entonces: esa es la razón de que no se lean del maestro al imprimir.

**Dónde se cambia**: el valor por defecto está en `src/lib/hr.ts` →
`TSS_DEFAULTS`. Una corrida ya creada mantiene los suyos; para usar unos nuevos,
se crean en la corrida siguiente.

> **Topes salariales cotizables.** El sistema calcula sobre el bruto completo.
> Si tienes personal por encima de los topes de la TSS (20 salarios mínimos para
> AFP, 10 para SFS), revisa esas líneas con tu contador antes de pagar: el ajuste
> por tope no está automatizado.

---

## 4. ISR sobre rentas del trabajo

La escala es **anual**, así que el sistema anualiza el salario del mes, aplica
los tramos y retiene la doceava parte. Aplicar los tramos directamente al sueldo
mensual —el error clásico— dejaría exento a todo el mundo.

| Renta anual (RD$) | Retención |
|---|---|
| Hasta 416.220,00 | Exento |
| 416.220,01 – 624.329,00 | 15 % del excedente de 416.220,00 |
| 624.329,01 – 867.123,00 | 31.216,00 + 20 % del excedente de 624.329,00 |
| Desde 867.123,01 | 79.776,00 + 25 % del excedente de 867.123,00 |

**El orden importa**: primero el bruto, después la Seguridad Social —que el ISR
no grava—, y sobre lo que queda, el ISR. Calcularlo sobre el bruto le retendría
de más a todo el mundo.

En una corrida quincenal se retiene la mitad de la retención mensual.

**Dónde se cambia**: `src/lib/hr.ts` → `ISR_BRACKETS`. Es el único sitio.

> Lo que este módulo **no** hace todavía: el bono navideño (regalía pascual), la
> bonificación por beneficios, las vacaciones pagadas y la prestación laboral por
> desahucio. Se registran como «otros ingresos» en la línea o se llevan aparte.

---

## 5. Qué se puede editar y qué no

**No hay ni un importe editable en la nómina.** Todo sale de los marcajes y de
los porcentajes congelados en la corrida. Si una línea está mal, **lo que está
mal es el marcaje**: se corrige en Asistencia y se vuelve a generar.

Mientras la corrida esté en **borrador** se puede volver a calcular tantas veces
como haga falta: solo trae los marcajes que todavía no ha reclamado, nunca
repite los ya incluidos.

Estados de una corrida:

- **Borrador** → se calcula, se corrige, se anula.
- **Aprobada** → ya no se recalcula; solo queda pagarla.
- **Pagada** → **no se anula**. El dinero ya salió; lo que corresponde es el
  ajuste en la corrida siguiente.
- **Anulada** → suelta sus marcajes, que vuelven a estar disponibles para la
  próxima corrida. Sin eso, esas horas no se pagarían nunca.

---

## 6. Certificaciones que bloquean

Una certificación con la casilla **«Bloquea asignación si vence»** marcada
impide, cuando está vencida o revocada:

- crear o editar un **turno** con esa persona,
- **publicar** el cuadrante que la incluya,
- asignarla como **recurso de una salida** o en una **ruta de recogida**.

Estar *a punto de vencer* **avisa pero no bloquea**: bloquear por «vence en tres
semanas» dejaría la operación sin guías un lunes cualquiera.

El estado que ves en pantalla se deduce de la fecha en el momento de pintarlo,
así que no depende de que el barrido diario haya corrido. El barrido
(`/api/cron/certifications`, todos los días a las 5:00 UTC) solo pone al día el
estado guardado y **avisa una vez al mes** por certificación.

`Revocada` y `Pendiente` son decisiones de una persona y el calendario nunca las
pisa.

---

## 7. Lo que tienes que configurar antes de la primera nómina

1. **En cada ficha de personal** (Equipo → Personal):
   - Tipo de sueldo y su importe (mensual, por día o por hora).
   - «Aplica Seguridad Social»: sí para empleados, no para externos que facturan.
   - NSS y cuenta bancaria, si vas a usar el archivo para pagar.
2. **Enlaza cada usuario con su ficha de personal** (campo «Usuario»). Sin ese
   enlace, esa persona no puede fichar su propia entrada.
3. **Marca las certificaciones que de verdad bloquean.** Por defecto ninguna lo
   hace: es una decisión tuya, no del sistema.
4. **Valida la primera corrida con tu contador** antes de pagarla. El archivo se
   descarga desde el detalle de la corrida, en CSV con BOM para que Excel en
   español lo abra con los acentos bien.
