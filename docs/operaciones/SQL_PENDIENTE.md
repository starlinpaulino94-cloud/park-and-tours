# SQL pendiente, en orden de pegado

**47 archivos, 15 migraciones (0088 → 0102), más los datos de demostración y dos verificaciones sueltas.**
Todos están en `supabase/editor/`. Se pegan enteros en el editor SQL de
Supabase (Ctrl+A en el archivo, pegar, «Run»).

---

## Antes de empezar: qué te falta de verdad

Esta lista es lo que falta **según el repositorio**. Lo que falta según **tu
base** lo dice ella misma, y es lo que manda. Corre primero estas dos y salta
todo lo que responda `OK`:

| | archivo | qué contesta |
| --- | --- | --- |
| 1 | `que_me_falta_1.sql` | un veredicto por migración, de la 0021 a la 0073 |
| 2 | `que_me_falta_2.sql` | lo mismo, de la 0074 en adelante |

Las dos solo leen. Una fila `FALTA` significa que esa migración no llegó al
final; `OK` que sí. Si quieres el detalle objeto por objeto:
`auditoria_funciones_1.sql`, `_2` y `_3`.

> Estas consultas se corren en cada integración contra una base con **todas** las
> migraciones aplicadas, y ni una fila puede decir `FALTA`. Es lo que evita que
> te manden a repetir algo que ya está: tres falsos `FALTA` salieron así (0072,
> 0038 y 0081) y están corregidos.

---

## El orden es el numérico, y ese es el único probado

Van de la **0088 a la 0102, en orden de número**. No es una preferencia: es el
orden en que se aplican en cada integración, sobre una base vacía, y el único
que está probado de punta a punta.

Hay dependencias reales dentro de la lista —0099 llama siete veces a
`departure_pax_totals`, que la crea la **0094**— así que saltarse el orden no es
una cuestión de estilo.

**Corrección a lo que te dije antes.** En una lista anterior puse la 0094 y la
0095 delante de la 0091–0093 porque la 0094 bloquea las ventas. Ese orden no
está probado; el numérico sí. Usa el numérico. La urgencia sigue siendo verdad y
está marcada abajo, pero se resuelve **haciendo la lista de una sentada**, no
reordenándola.

Todas aguantan ejecutarse dos veces. Si una parte falla a medias, vuelve a
ejecutar esa parte entera.

---

## La lista

Las filas marcadas **⛔** son las que tienen algo roto o abierto mientras no se
aplican. Las marcadas *(lee)* no cambian nada.

### 0088 — De quién es cada parada, y a qué hora se marcó

| | archivo |
| --- | --- |
| 1 | `0088_parte_1.sql` |
| 2 | `0088_parte_2.sql` |
| 3 | `0088_parte_3_verificacion.sql` *(lee)* |

Añade `supplier_id` y `service_date` a `pickup`. Sin esto la hoja de ruta del
chofer no se puede acotar por proveedor.

### 0089 — El estado de cuenta del proveedor

| | archivo |
| --- | --- |
| 4 | `0089_parte_1.sql` |
| 5 | `0089_parte_2.sql` |
| 6 | `0089_parte_3_verificacion.sql` *(lee)* |

La fila 8 de la verificación es la que importa: sin el índice único, **el mismo
NCF del mismo proveedor entra dos veces** y eso es una factura duplicada ante la
DGII.

### 0090 — El manifiesto sale solo, y sale recortado

| | archivo |
| --- | --- |
| 7 | `0090_parte_1.sql` |
| 8 | `0090_parte_2_verificacion.sql` *(lee)* |

### 0091 — El gasto del monedero, en una sola escritura

| | archivo |
| --- | --- |
| 9 | `0091_parte_1.sql` |
| 10 | `0091_parte_2_verificacion.sql` *(lee)* |

Serializa el saldo prepago del socio con cerrojo sobre su fila. Sin esto, dos
ventas simultáneas del mismo socio pueden gastar el mismo saldo dos veces.

### 0092 — Lista negra de clientes

| | archivo |
| --- | --- |
| 11 | `0092_parte_1.sql` |
| 12 | `0092_parte_2_verificacion.sql` *(lee)* |

### 0093 ⛔ — El enganche del token, entero otra vez

| | archivo |
| --- | --- |
| 13 | `0093_parte_1.sql` |
| 14 | `0093_parte_2_verificacion.sql` *(lee)* |

0084 reescribió el enganche del token partiendo de una versión vieja y perdió
dos cosas por el camino, entre ellas la **empresa activa del selector**.

> **Después de esta: cierra sesión y vuelve a entrar.** El enganche solo se
> aplica al emitir un token nuevo; con el que ya tienes en el navegador seguirás
> viendo el comportamiento viejo y parecerá que no funcionó.

### 0094 ⛔⛔ — Los pasajeros de una salida se cuentan en la base

| | archivo |
| --- | --- |
| 15 | `0094_parte_1.sql` |
| 16 | `0094_parte_2_verificacion.sql` *(lee)* — cinco filas, todas OK |

**Hasta que esto esté, la aplicación no puede vender.** `assertCapacity` llama a
`departure_pax_totals` en cada venta y, si no existe, la venta falla con un error
de función inexistente. Y la 0099 la necesita.

### 0095 — Las referencias de dinero no cruzan de empresa

| | archivo |
| --- | --- |
| 17 | `0095_parte_1.sql` |
| 18 | `0095_parte_2.sql` |
| 19 | `0095_parte_3_verificacion.sql` *(lee)* |

También arregla algo que llevaba roto desde 0081: **abrir caja a nombre de un
socio** daba un error de esquema crudo en vez de funcionar.

### 0096 — El panel deja de arrastrar la fila entera

| | archivo |
| --- | --- |
| 20 | `0096_parte_1.sql` |
| 21 | `0096_parte_2.sql` |
| 22 | `0096_parte_3.sql` |
| 23 | `0096_parte_4.sql` |
| 24 | `0096_parte_5.sql` |
| 25 | `0096_parte_6.sql` |
| 26 | `0096_parte_7_verificacion.sql` *(lee)* |

`dashboard_summary` son 20 kB de una sola sentencia y el editor trunca los
pegados largos, así que las seis primeras partes **dejan el texto guardado a
trozos** y la sexta lo ejecuta. **Las seis, en orden, o no hay función.** La
séptima comprueba que llegó completa.

Medido: la ventana de 365 días baja de ~800 a ~450 ms con la salida idéntica.

### 0097 — Una sola visita a la fila padre por referencia

| | archivo |
| --- | --- |
| 27 | `0097_parte_1.sql` |
| 28 | `0097_parte_2_verificacion.sql` *(lee)* |

Medido: insertar una reserva baja de 0,76 a 0,66 ms.

### 0098 ⛔ — El estado de la membresía en el espejo de MembeGo

| | archivo |
| --- | --- |
| 29 | `0098_parte_1.sql` |
| 30 | `0098_parte_2_verificacion.sql` *(lee)* |

**Esta va antes del código, no después.** Sin la columna, el upsert del webhook
falla por columna inexistente y los eventos se acumulan en la cola de MembeGo.

### 0099 ⛔⛔ — La plaza se retiene antes de venderla

| | archivo |
| --- | --- |
| 31 | `0099_parte_1.sql` |
| 32 | `0099_parte_2.sql` |
| 33 | `0099_parte_3.sql` |
| 34 | `0099_parte_4.sql` |
| 35 | `0099_parte_5_verificacion.sql` *(lee)* |

**Hasta que esto esté, se puede vender de más.** Medido: treinta ventas
simultáneas de la última plaza en una salida de diez dejaban **diecinueve
reservas**. Con esto, diez.

Necesita la 0094 aplicada.

### 0100 ⛔ — El cupo del socio se reclama, no se recalcula

| | archivo |
| --- | --- |
| 36 | `0100_parte_1.sql` |
| 37 | `0100_parte_2.sql` |
| 38 | `0100_parte_3_verificacion.sql` *(lee)* |

Medido: treinta ventas de un socio contra un contrato de diez plazas pasaban
**todas**, y el contador se quedaba en 2 — peor que la sobreventa de plazas,
porque la pantalla seguía mostrando cupo libre.

### 0101 ⛔ — La caja: tres comprobar-y-actuar sobre dinero

| | archivo |
| --- | --- |
| 39 | `0101_parte_1_antes.sql` *(lee — **córrela primero**)* |
| 40 | `0101_parte_2.sql` |
| 41 | `0101_parte_3.sql` |
| 42 | `0101_parte_4.sql` |
| 43 | `0101_parte_5_verificacion.sql` *(lee)* |

**La parte 1 va primero y solo lee.** Busca las filas que impedirían crear los
índices únicos —dos turnos abiertos en la misma caja, asientos repetidos— y **te
las nombra**. Si encuentra algo, hay que decidir qué fila se queda antes de
seguir: eso no lo puede adivinar un script.

Medido: **dieciocho turnos abiertos** sobre el mismo cajón, y el mismo faltante
**asentado veinte veces** en el libro.

### 0102 — Las referencias a una persona se comprueban siempre

| | archivo |
| --- | --- |
| 44 | `0102_parte_1.sql` |
| 45 | `0102_parte_2.sql` |
| 46 | `0102_parte_3.sql` |
| 47 | `0102_parte_4_verificacion.sql` *(lee)* — la fila 3 tiene que decir **105** |

Comprueba 36 referencias en 25 tablas: toda referencia a una persona —cliente,
vendedor, proveedor— o a un documento sobre una persona —reserva, venta—. La más
cara de la lista no es de dinero: `supplier_response_token.supplier_id` es la
llave del portal del proveedor, y apuntando a otro proveedor ese enlace de un
solo uso **abre el portal de otra empresa**.

---

## Datos de demostración

No son migraciones: llenan módulos que salen en blanco. Van después, y solo si
esas pantallas te aparecen vacías. Necesitan el sembrador de demostración ya
aplicado (la empresa `havelgo-demo-presentaciones` y sus productos).

| | archivo | qué deja de salir vacío |
| --- | --- | --- |
| a | `demo_socios_1.sql` | los dos socios, su contrato y qué pueden vender |
| b | `demo_socios_2.sql` | tarifario neto, cupos garantizados y monedero prepago |
| c | `demo_embudo_1.sql` | el embudo de atribución del vendedor |
| d | `demo_embudo_2.sql` | los ajustes de comisión con su neto y su liquidación |

`demo_paquete.sql` trae el combo «Gran Combo Punta Cana» con sus propias
salidas. Córrelo si la pantalla de paquetes está vacía.

---

## Las dos verificaciones que quedaron sin correr

Son de migraciones que **sí están aplicadas**, pero cuya comprobación nunca se
leyó. No cambian nada; solo dicen si aquello quedó bien.

| | archivo |
| --- | --- |
| i | `0073_parte_2_verificacion.sql` — ciclo de vida del socio |
| ii | `0075_parte_2_verificacion.sql` — cartera del socio |

**Eran tres y ya son dos.** La tercera que te pedí era comprobar el cuerpo del
enganche del token de 0084, y ya no aplica: la **0093** reescribe ese enganche
entero, y su `0093_parte_2_verificacion.sql` —el paso 12 de la lista— comprueba
lo mismo y además que `supplier_id` siga en el token. Correrla por separado no
añadiría nada. (Cuidado con `0084_parte_3.sql`, por si acaso: no es una
verificación, **escribe** — y lo que escribe es justo lo que la 0093 sustituye.)

---

## Lo que NO está en esta lista

- **El simulacro de restauración.** No es SQL que se pegue: son ocho pasos
  contra un proyecto de Supabase nuevo, unos treinta minutos, escritos en
  `docs/runbooks/RESTAURACION.md`. Mientras el registro de simulacros de ese
  manual esté vacío, DR-001 no está cerrado.
- **La limpieza de las empresas de prueba**, en `limpieza_e2e_1_inventario.sql`
  → `limpieza_e2e_2_borrado.sql` → `limpieza_e2e_3_verificacion.sql`. La primera solo lee y te dice qué
  se iría. Es aparte porque **borra**.
- **El conteo de usuarios del plan**, en
  `medir_usuarios_antes_de_activar_el_conteo.sql`, y el vínculo de vendedores en
  `vinculo_vendedores_1_propuesta.sql` →
  `vinculo_vendedores_2_vincular_una.sql` → `vinculo_vendedores_3_quien_queda.sql`. Las dos empiezan por una consulta que solo lee.

---

## Si algo falla

1. Vuelve a ejecutar esa parte **entera**. Todas aguantan repetirse.
2. Si el error dice `syntax error at end of input`, el pegado llegó cortado:
   copia el archivo otra vez con Ctrl+A.
3. Si una verificación dice `FALTA`, la migración no llegó al final. Repítela
   entera y vuelve a verificar.
4. Si sigue fallando, manda el mensaje de error tal cual, con el nombre del
   archivo.
