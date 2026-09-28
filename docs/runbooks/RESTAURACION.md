# Volver de una copia

> **Estado de DR-001.** El *procedimiento* y la *comprobación* están probados:
> `scripts/restore-drill.sh` monta una base con el esquema real y datos, la
> vuelca, **la destruye**, la restaura y comprueba que lo que queda sirve — y
> después la rompe cuatro veces a propósito para verificar que la comprobación
> sabe fallar. Corre en cada CI.
>
> Lo que **sigue sin hacerse ni una vez** es esto mismo contra el proyecto de
> verdad. Son los treinta minutos de abajo, y hasta que alguien los dedique,
> DR-001 no está cerrado: está reducido.

---

## Por qué esto necesita un manual

Porque «la restauración funcionó» casi siempre quiere decir «el comando terminó
sin error», y en este sistema eso no basta. Una base restaurada a la que le
falte el esquema `app` o sus políticas **arranca, atiende y no da un solo
error**: devuelve cero filas a todo el mundo, porque todas las políticas
comparan contra `app.current_org_id()`.

Un sistema vacío y silencioso es igual de malo que uno caído, y encima parece
bueno el rato suficiente para que alguien dé la restauración por terminada y se
vaya a dormir.

---

## Lo que NO está en la copia

Una copia de Supabase es una copia de **la base**. Tres cosas que hacen falta
para que el sistema funcione no viven ahí, y hay que reponerlas a mano. La
primera es la que arruina las restauraciones:

### 1. El enganche del token, REGISTRADO

La función `app.custom_access_token_hook` está en la base y la copia la trae.
Que Auth esté configurado para **llamarla** es ajuste del proyecto, y eso no
viaja.

Sin registrar: los tokens salen sin `org_id`, `app.current_org_id()` devuelve
nulo, y **la RLS no deja ver nada**. Todo funciona, todo está vacío.

> En el panel de Supabase: **Authentication → Hooks → Customize Access Token**,
> apuntando a `app.custom_access_token_hook`. En local lo declara
> `supabase/config.toml` (`[auth.hook.custom_access_token]`).

Y después de registrarlo: **cerrar sesión y volver a entrar**. El token viejo
sigue siendo válido hasta que caduca y sigue sin los atributos — el enganche
solo corre al emitir uno nuevo.

### 2. Los archivos de Storage

El volcado trae la tabla `storage.objects` —los nombres— pero **no los bytes**.
Vouchers, logos, documentos de vehículos y adjuntos quedan como filas que
apuntan a archivos que no están.

### 3. Las variables de entorno

Llaves de Stripe, `MEMBEGO_SECRETO`, tokens de correo y de WhatsApp,
`SUPABASE_SERVICE_ROLE_KEY`. Están en Vercel, no en la base. Y con ellas, los
crons de Vercel y el endpoint del webhook de Stripe, que apunta a un dominio.

### 4. Y una que sí está en la copia, pero que vuelve MAL

No falta: **sobra pasado**. Es la única de esta lista cuyo daño es legal.

`ncf_sequence.next_number` —el próximo comprobante fiscal a emitir— es un
contador en una tabla, no una secuencia de Postgres. Una restauración a un punto
anterior en el tiempo **lo devuelve a donde estaba**, y las facturas emitidas
después de ese punto ya llevan su número impreso, enviado al cliente y
declarado.

El siguiente NCF que emita el sistema **repite uno que ya existe**. Dos
comprobantes fiscales con el mismo número no es un descuadre que se arregla con
un ajuste: es una factura que la DGII rechaza y un cliente con un documento que
no vale.

La fila **11** de `supabase/verify/restauracion.sql` lo caza, y dice por qué
número va el contador y qué número ya está emitido. Si sale en rojo, hay que
subir el contador **antes de que nadie emita nada**:

```sql
-- Deja cada contador justo por encima del último NCF ya emitido de su tipo.
-- Se ejecuta ANTES de dejar facturar. No inventa números: mira lo emitido.
update ncf_sequence q
   set next_number = greatest(q.next_number, 1 + (
         select max(nullif(substring(i.ncf from length(q.ncf_type) + 1), '')::bigint)
           from invoice i
          where i.organization_id = q.organization_id
            and lower(i.ncf_type) = lower(q.ncf_type)
            and substring(i.ncf from length(q.ncf_type) + 1) ~ '^[0-9]+$'
       ))
 where exists (select 1 from invoice i
                where i.organization_id = q.organization_id
                  and lower(i.ncf_type) = lower(q.ncf_type));
```

Y después, **volver a pegar la fila 11** para ver que quedó en `OK`.

> Ojo con el otro lado: si lo que se perdió son FACTURAS —se restauró a un punto
> anterior a ellas— el contador queda por delante y eso **no se toca**. Un hueco
> en la numeración se explica a la DGII; un número repetido, no.

---

## Los treinta minutos, en orden

Hacerlo **a un proyecto nuevo**, nunca encima del que está vivo. Restaurar sobre
producción para «probar» es cómo se convierte un simulacro en un incidente.

1. **Crear un proyecto de Supabase nuevo** y anotar su URL y sus llaves.
2. **Restaurar la copia** en él, por el panel o con `pg_restore`.
3. **Registrar el enganche del token** (punto 1 de arriba).
4. **Pegar `supabase/verify/restauracion.sql`** en el editor SQL. Devuelve trece
   filas; **todas** tienen que decir `OK`. Cualquier `REVISAR` trae al lado el
   porqué importa —y las que pueden, dicen además QUÉ falta.
5. **Si la fila 11 salió en rojo, subir el contador de NCF** (punto 4 de arriba)
   antes de dejar facturar a nadie. Va aquí, antes de abrir el sistema: el primer
   NCF repetido ya no se puede retirar del cliente.
6. **Entrar con una cuenta de verdad** apuntando la aplicación al proyecto
   nuevo, y comprobar tres cosas que el SQL no puede ver:
   - que se ve el listado de reservas **con filas** (si sale vacío, es el
     enganche);
   - que un voucher **abre su PDF** (si no, son los archivos de Storage);
   - que el selector de empresa **cambia de empresa** de verdad.
7. **Apuntar cuánto tardó**, de principio a fin, en el registro de abajo. Es el
   número que hace falta para decidir en el peor día si se restaura o se espera.
8. **Borrar el proyecto de prueba.**

---

## Registro de simulacros

Una línea por vez que se haya hecho contra un proyecto de verdad. Si esta tabla
está vacía, DR-001 sigue abierto por mucho que el CI esté en verde.

| Fecha | Quién | Copia de | Tardó | Qué falló | Notas |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | *Todavía no se ha hecho ninguno.* |
