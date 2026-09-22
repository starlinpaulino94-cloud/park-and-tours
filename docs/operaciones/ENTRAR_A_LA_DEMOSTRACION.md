# Entrar a la demostración

Dos caminos, para dos cosas distintas.

---

## Lo que pasaba antes

El sembrador creaba una empresa hermana de demostración y le daba a tu usuario
una membresía con `is_primary: false` —a propósito, para que nadie aterrizara
ahí por accidente—. Su propio mensaje final decía:

> «Entra y cambia a la empresa de demostración en el selector.»

**Ese selector no existía.** La empresa de la sesión la decide el hook de la
base con `order by is_primary desc ... limit 1`, así que siempre ganaba la
empresa real, y no había ninguna forma de cambiarla. La demostración quedaba
escrita y era inalcanzable: la misma clase de defecto que una columna que nadie
lee o una plantilla que nadie encola.

La única puerta era la suplantación del superadministrador, que es otra cosa
—entra a **cualquier** empresa, dura dos horas y existe para soporte—.

---

## 1 · El selector, para ti

Arriba a la izquierda, sobre el menú. **Solo aparece si perteneces a más de una
empresa**: quien está en una sola no tiene nada que elegir.

Al lado de cada empresa va **tu rol ahí**, que no tiene por qué ser el mismo.
Entrar creyendo que mandas y descubrir que no puedes hacer nada es la sorpresa
que ese texto evita.

Mientras trabajes fuera de tu empresa principal, una **banda azul** te lo
recuerda en cada pantalla, con un botón para volver. No es decoración: la
empresa de demostración tiene clientes inventados, reservas que nadie hizo y
comisiones que nadie cobró. Media hora operando ahí creyendo que es la de verdad
—cobrar, cerrar caja, cancelar una salida— es un daño que no se deshace tirando
de un hilo.

### Qué lo hace seguro

| | |
| --- | --- |
| **La cookie guarda la empresa, no quién eres** | En cada petición se vuelve a buscar la membresía. Una cookie editada a mano solo consigue que el servidor busque algo que no existe y te deje donde estabas. |
| **El rol sale de la empresa de destino** | Quien es `owner` en la suya y `operations` en la de al lado entra como `operations`. Conservar el rol de origen no sería un selector: sería una escalada de privilegios a un clic, y encima invisible. |
| **Una membresía desactivada deja de valer en la petición siguiente** | Sin sesión que cerrar. |
| **Queda en la auditoría** | Quién entró, a dónde y con qué rol. |
| **Solo donde ya te dieron de alta** | Una empresa que no existe y una donde no tienes membresía se contestan igual, para que esta ruta no sirva para averiguar qué empresas hay. |

---

## 2 · Cuentas propias, para entregar

El selector sirve para ti. Estas cuentas sirven para lo otro: darle una a un
comercial, a un cliente que quiere trastear el fin de semana, o a quien prepara
una feria — **sin darle acceso a tu operación de verdad**.

```bash
npm run seed:demo-presentation
```

Al terminar imprime las tres:

| Cuenta | Rol | Para enseñar |
| --- | --- | --- |
| `demo@<empresa>-demo.demo.local` | Propietario | Todo el sistema |
| `demo.ventas@<empresa>-demo.demo.local` | Vendedor | Que **no** ve márgenes ni costes |
| `demo.guia@<empresa>-demo.demo.local` | Operación | Manifiestos y despacho, nada más |

Son tres y no una a propósito: enseñar el sistema desde el propietario da la
impresión de un ERP sin permisos. Lo que de verdad convence es ver que el
vendedor no llega a los márgenes.

### La contraseña

Se genera y **se imprime una sola vez**. No se guarda en ningún archivo ni en el
repositorio: una contraseña de demostración escrita en un fichero es justo la
que nadie cambia nunca, y es una credencial válida contra tu base real.

- ¿Se te olvidó? Vuelve a ejecutar el sembrador: repone las tres.
- ¿Prefieres una tuya? `DEMO_USER_PASSWORD=… npm run seed:demo-presentation`
  (mínimo 12 caracteres).

El dominio `.demo.local` no existe a propósito: ninguna de estas cuentas puede
recibir un correo de verdad.

### Al borrar la demo

```bash
npm run seed:demo-presentation -- --remove
```

Se lleva también las tres cuentas. Si se quedaran, serían credenciales válidas
contra tu proyecto de Supabase, sin empresa, esperando a que alguien les diera
una membresía por error.

---

## Si una cuenta no entra

El formulario dice lo mismo a tres cosas distintas:

- la cuenta **no existe** en este proyecto de Supabase;
- la cuenta existe y **la contraseña no es esa**;
- la cuenta existía en **otro proyecto** — el de antes de una migración.

Las junta a propósito: distinguirlas ahí convertiría la pantalla de acceso en un
buscador de correos. Quien administra sí puede mirar, y para eso está:

```bash
npm run check:account -- --email=persona@empresa.com
```

Dice a qué proyecto de Supabase está apuntando, si la cuenta existe **ahí**, si
su email está confirmado, si está bloqueada, y a qué empresas pertenece con qué
rol — con la de aterrizaje marcada. **Solo lee**: no cambia una sola fila.

¿Sin terminal? Lo mismo, bloque a bloque, para pegar en el editor SQL de
Supabase: **[Arreglar un acceso desde el editor SQL](./DESDE_EL_EDITOR_SQL.md)**.

Si falta algo, el propio comprobador imprime la orden que lo arregla:

```bash
node scripts/migrate/onboard-user.mjs --email=persona@empresa.com \
  --org=<slug-de-la-empresa> --role=owner --password='<clave>'
```

Ese script crea la cuenta si no existe, le repone la contraseña si existe, la
deja con el email confirmado y le asegura la membresía. Ojo con una cosa: pone
esa empresa como **primaria** y le quita la marca a las demás, así que pásale el
slug de donde quieres que aterrice.

### `demopresentaciones@havelgo.com`

Esa cuenta es del sembrador **viejo**, que traía una empresa fija escrita en el
código y **no creaba el usuario**: exigía que ya estuviera dado de alta a mano en
Supabase Auth. Hoy ninguna orden del repositorio la crea, así que si el proyecto
al que apunta el despliegue no la tiene, no hay contraseña que valga.

Las de ahora son las tres de arriba, `demo@…demo.local`, y se crean solas.

---

## El caso que costó entenderlo: el E2E se quedaba la cuenta

Merece estar escrito, porque desde fuera era indistinguible de una contraseña
mal tecleada.

El secreto `E2E_EMAIL` del CI apuntaba a una cuenta de demostración que se
usaba de verdad. El arranque de Playwright, que corre con la llave de servicio,
hacía dos cosas en **cada ejecución** —o sea, en cada PR—:

- le **reescribía la contraseña** con `E2E_PASSWORD`;
- le movía la **membresía primaria** a la empresa `e2e-tenant`.

Resultado: la persona tecleaba su contraseña, que era correcta cuando la puso, y
el formulario la rechazaba. Y si conseguía entrar, aterrizaba en un inquilino de
pruebas vacío. Nada de lo que se veía en pantalla apuntaba a la causa, porque la
causa no estaba pasando en ese momento: había pasado la última vez que alguien
abrió un PR.

**Hoy el arranque se niega.** Si `E2E_EMAIL` pertenece a alguna empresa que no
sea la del E2E, falla diciendo qué cuenta, qué empresa la reclama y qué hacer,
en vez de apropiársela. Un E2E en rojo cuesta una ejecución; apropiarse de una
cuenta cuesta que alguien no pueda trabajar sin entender por qué.

Si te pasa a ti, se ve así en la consulta de diagnóstico: la cuenta existe, está
confirmada, tiene contraseña, y la ★ está sobre **E2E Tenant**. Eso no es un
problema de la cuenta: es esto.

---

## Cargar la demostración con datos

Entrar a la empresa demo y no ver nada es peor que no entrar: parece que el
sistema está vacío. Para llenarla —catálogo, clientes, ventas, cobros, facturas,
comisiones, operación, caja, almacén y plataforma— hay un sembrador SQL que se
pega en el editor de Supabase:

```
supabase/seed/demo_presentation.sql
```

Ábrelo, cópialo entero, pégalo en **SQL Editor** de Supabase y ejecútalo. Tarda
unos segundos y al final imprime un recuento por módulo. Carga sobre la empresa
`havelgo-demo-presentaciones`, que es donde aterrizas; si no existe, la crea.

Lo que deja cargado, aproximadamente:

| Módulo | Filas |
| --- | --- |
| Productos (tours) y modalidades | 12 + 24 |
| Clientes | 40 |
| Salidas (pasadas y futuras) | 60 |
| Reservas con su rastro (pagos, vouchers, participantes) | 60 |
| Facturas con NCF | 36 |
| Comisiones de vendedor | 60 |
| Costes de proveedor, gastos 606, cuentas por cobrar | sí |
| Leads, cotizaciones, encuestas NPS respondidas | sí |
| Caja, almacén, tareas, notificaciones, auditoría | sí |

**Se puede ejecutar las veces que quieras.** Empieza borrando lo que sembró la
vez anterior (solo de la empresa demo) y vuelve a sembrar: dos ejecuciones dejan
el mismo resultado, no el doble. Y no toca tu operación real — todo cuelga de la
empresa demo, que la RLS mantiene aparte.

Los importes **cuadran entre módulos**: el total de una orden es la suma de sus
reservas, los pagos no superan lo facturado, y la comisión sale del total de la
venta. No son filas sueltas: es una operación coherente, que es lo que hace
creíble una demostración.

### Si tu base va por detrás de las migraciones

El sembrador es tolerante: si una tabla no existe todavía (porque tu proyecto no
tiene aplicada la migración que la crea), la **omite y sigue**, y te avisa con un
`WARNING` nombrando la tabla que faltó. Carga todo lo demás igual.

Eso es una pista, no un adorno: significa que hay migraciones pendientes, y que
esa parte de la app tampoco funciona hasta aplicarlas. Por ejemplo, si ves
`guest_survey no existe (falta la migración 0067)`, las encuestas no se sembraron
**y** la pantalla de «La voz del cliente» no funciona en la app. Para ponerlo al
día, aplica los archivos de `supabase/migrations/` posteriores al último que
tengas, en orden, pegándolos en el editor SQL. Luego vuelve a correr el
sembrador y esta vez sí carga esa parte.

> Igual que el resto de SQL de esta guía, el sembrador **se ejecuta en CI** —dos
> veces, para comprobar que de verdad es idempotente— contra un Postgres con
> todas las migraciones. Si una migración cambia una tabla que llena, el CI se
> pone rojo en vez de fallar delante de un cliente.

---

## Lo que NO cambió

- Tu empresa real no se toca nunca. La demo es una empresa aparte, con
  `tenant_org_id` apuntándose a sí misma: la RLS las mantiene separadas.
- La membresía que el sembrador te da en la demo sigue naciendo
  `is_primary: false`. Al entrar, sigues aterrizando en tu operación.
- La suplantación del superadministrador sigue siendo lo que era: soporte, a
  cualquier empresa, dos horas y con su banda ámbar.

---

## Dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| La empresa activa de la sesión | `src/lib/supabase/auth-context.ts` |
| A qué empresas puede entrar alguien | `src/lib/workspace-service.ts` |
| La ruta del cambio | `POST /api/workspace` |
| El selector y la banda | `src/components/tf/app-shell.tsx` |
| El sembrador y las cuentas | `scripts/seed-demo-presentation.mjs` |
| Cargar la demo con datos (SQL) | `supabase/seed/demo_presentation.sql` |
| Por qué una cuenta no entra | `npm run check:account` |
| Qué se le dice a quien no entra | `src/lib/auth-errors.ts` |
