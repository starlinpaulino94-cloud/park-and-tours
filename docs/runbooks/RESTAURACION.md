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

---

## Los treinta minutos, en orden

Hacerlo **a un proyecto nuevo**, nunca encima del que está vivo. Restaurar sobre
producción para «probar» es cómo se convierte un simulacro en un incidente.

1. **Crear un proyecto de Supabase nuevo** y anotar su URL y sus llaves.
2. **Restaurar la copia** en él, por el panel o con `pg_restore`.
3. **Registrar el enganche del token** (punto 1 de arriba).
4. **Pegar `supabase/verify/restauracion.sql`** en el editor SQL. Devuelve once
   filas; **todas** tienen que decir `OK`. Cualquier `REVISAR` trae al lado el
   porqué importa.
5. **Entrar con una cuenta de verdad** apuntando la aplicación al proyecto
   nuevo, y comprobar tres cosas que el SQL no puede ver:
   - que se ve el listado de reservas **con filas** (si sale vacío, es el
     enganche);
   - que un voucher **abre su PDF** (si no, son los archivos de Storage);
   - que el selector de empresa **cambia de empresa** de verdad.
6. **Apuntar cuánto tardó**, de principio a fin, en el registro de abajo. Es el
   número que hace falta para decidir en el peor día si se restaura o se espera.
7. **Borrar el proyecto de prueba.**

---

## Registro de simulacros

Una línea por vez que se haya hecho contra un proyecto de verdad. Si esta tabla
está vacía, DR-001 sigue abierto por mucho que el CI esté en verde.

| Fecha | Quién | Copia de | Tardó | Qué falló | Notas |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | *Todavía no se ha hecho ninguno.* |
