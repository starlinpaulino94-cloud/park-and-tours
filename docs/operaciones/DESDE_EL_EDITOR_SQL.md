# Arreglar un acceso desde el editor SQL

Sin terminal. Cada bloque se pega entero en **SQL Editor** de Supabase y se
ejecuta tal cual; sólo hay que cambiar el correo de la primera línea.

> **Antes de nada.** El editor SQL manda sobre la base, no sobre el servicio de
> identidad. Eso parte el trabajo en dos mitades desiguales:
>
> | | Desde SQL |
> | --- | --- |
> | Ver qué pasa | **sí**, entero |
> | Confirmar un email | **sí** |
> | Dar o cambiar una membresía | **sí** |
> | Crear la cuenta o ponerle contraseña | **no sin riesgo** — se hace en dos clics en *Authentication → Users* |
> | Sembrar los datos de demostración | **no** |
>
> Las dos últimas tienen su apartado más abajo, con lo que sí se puede hacer.

---

## 0 · Que la sesión del editor vea de verdad

Estas tablas llevan `force row level security`. Si la conexión no la puentea,
las consultas siguientes devuelven **cero filas sin dar error**, que es la peor
forma de equivocarse: parece un diagnóstico y es un espejismo.

```sql
select current_user,
       (select rolbypassrls from pg_roles where rolname = current_user) as ve_todo,
       (select count(*) from organizations)               as empresas,
       (select count(*) from organization_memberships)    as membresias;
```

`ve_todo` tiene que decir `true`. Si dice `false` o los recuentos salen en 0
teniendo datos, estás en una conexión restringida: abre el editor desde el panel
del proyecto como propietario, no con una clave de rol limitado.

---

## Antes de los bloques: una sola consulta que lo contesta todo

Si no quieres ir bloque a bloque, pega **sólo esto**. Cambia el correo de la
primera línea y nada más. Devuelve diez filas y la última dice qué hacer.

```sql
with objetivo as (
  select lower('demopresentaciones@havelgo.com') as email   -- ← cambia sólo esto
),
u as (
  select usr.* from auth.users usr, objetivo o where lower(usr.email) = o.email
),
mem as (
  select m.is_primary, m.role, m.status as mem_status,
         org.name, org.slug, org.status as org_status
    from organization_memberships m
    join organizations org on org.id = m.organization_id
   where m.user_id = (select id from u)
)
select * from (values
  ('0 · la sesión del editor lo ve todo',
   case when (select rolbypassrls from pg_roles where rolname = current_user)
        then 'sí' else 'NO — lo de abajo puede salir vacío sin ser verdad' end),

  ('1 · la cuenta existe en este proyecto',
   case when exists (select 1 from u) then 'SÍ'
        else 'NO — ninguna contraseña va a funcionar. Créala en Authentication → Users' end),

  ('2 · email confirmado',
   coalesce((select case when email_confirmed_at is not null then 'sí'
                         else 'NO — el acceso se rechaza aunque la clave sea correcta' end from u), '—')),

  ('3 · tiene contraseña',
   coalesce((select case when encrypted_password is not null then 'sí'
                         else 'NO — se creó por invitación: no hay clave que probar' end from u), '—')),

  ('4 · identidad de correo',
   coalesce((select case when exists (select 1 from auth.identities i
                                       where i.user_id = u.id and i.provider = 'email')
                         then 'sí' else 'NO — GoTrue no la reconoce como cuenta de correo' end from u), '—')),

  ('5 · bloqueada',
   coalesce((select case when (to_jsonb(u) ->> 'banned_until')::timestamptz > now()
                         then 'SÍ, hasta ' || (to_jsonb(u) ->> 'banned_until')
                         else 'no' end from u), '—')),

  ('6 · borrada',
   coalesce((select case when (to_jsonb(u) ->> 'deleted_at') is not null
                         then 'SÍ — no se recupera, hay que crear otra' else 'no' end from u), '—')),

  ('7 · último acceso',
   coalesce((select coalesce(last_sign_in_at::text, 'nunca ha entrado') from u), '—')),

  ('8 · empresas (★ = donde aterriza)',
   coalesce((select string_agg(
              case when is_primary then '★ ' else '  ' end
              || name || ' [' || coalesce(slug,'sin slug') || '] rol=' || role
              || ' membresía=' || mem_status || ' empresa=' || org_status,
              e'\n' order by is_primary desc, name)
             from mem),
            case when exists (select 1 from u)
                 then 'NINGUNA — entraría pero no vería nada: hace falta darle membresía'
                 else '—' end)),

  ('9 · qué hacer',
   case
     when not exists (select 1 from u)
       then 'La cuenta no está aquí. Authentication → Users → Add user (Auto Confirm), y luego dale membresía.'
     when (select email_confirmed_at from u) is null
       then 'Confirma el email (bloque 4 del cuaderno) y vuelve a probar.'
     when not exists (select 1 from mem where mem_status = 'active')
       then 'Existe y puede entrar, pero no pertenece a ninguna empresa activa: dale membresía.'
     when not exists (select 1 from mem where mem_status = 'active' and is_primary)
       then 'Todo bien salvo que ninguna membresía es la primaria: aterriza donde salga por fecha.'
     else 'Nada impide el acceso desde la base. Si el formulario lo rechaza, es la CONTRASEÑA: Authentication → Users → Reset password.'
   end)
) as t(comprobacion, resultado);
```

Funciona también cuando la cuenta **no existe** — que es el caso que hay que
distinguir — y entonces las filas que dependen de ella salen con `—` en vez de
inventarse un estado. Lo de abajo es lo mismo, desglosado, para cuando haga
falta mirar una cosa concreta o arreglarla.

> **Ojo con `supabase/tests/sql_playbook.test.sql`.** Ese fichero NO se pega
> aquí: es la prueba automática de esta página y usa órdenes de `psql`
> (`\set`, `\echo`) que el editor de Supabase no entiende — da
> `syntax error at or near "\"`. Corre en CI. Lo que se pega es lo de esta
> página.

---

## 1 · ¿Existe la cuenta en ESTE proyecto?

Es la pregunta que la pantalla de acceso no puede contestar, porque contesta lo
mismo a «no existe» y a «la contraseña no es esa» — a propósito, para que el
formulario no sirva de buscador de correos.

```sql
with objetivo as (select lower('demopresentaciones@havelgo.com') as email)
select
  u.id,
  u.email,
  u.created_at                                            as creada,
  u.last_sign_in_at                                       as ultimo_acceso,
  (u.email_confirmed_at is not null)                      as email_confirmado,
  (u.encrypted_password is not null)                      as tiene_contrasena,
  (to_jsonb(u) ->> 'banned_until')                        as bloqueada_hasta,
  (to_jsonb(u) ->> 'deleted_at')                          as borrada,
  exists (select 1 from auth.identities i
           where i.user_id = u.id and i.provider = 'email') as identidad_email
from auth.users u, objetivo o
where lower(u.email) = o.email;
```

**Cero filas = la cuenta no existe aquí.** Ninguna contraseña va a funcionar, y
no es culpa de lo que tecleas. Salta al apartado 5.

Si sale una fila, léela así:

| Columna | Si sale `false` |
| --- | --- |
| `email_confirmado` | El acceso se rechaza aunque la contraseña sea correcta → bloque 4 |
| `tiene_contrasena` | La cuenta se creó por invitación o por otro proveedor: no hay contraseña que probar → apartado 5 |
| `identidad_email` | Igual que la anterior; GoTrue no la reconoce como cuenta de correo |
| `bloqueada_hasta` | Con fecha futura, está bloqueada. Se levanta en *Authentication → Users* |
| `borrada` | Con fecha, la cuenta está borrada en blando. No se recupera: se crea otra |

---

## 2 · ¿A qué empresas pertenece, y dónde aterriza?

Sin membresía activa, el enganche del token no inyecta `org_id`: la sesión se
abre **sin empresa** y con la RLS puesta no se ve absolutamente nada. Es la
segunda causa de «entro pero no funciona».

```sql
with objetivo as (select lower('demopresentaciones@havelgo.com') as email)
select
  case when m.is_primary then '★' else ' ' end as aterriza,
  org.name                                     as empresa,
  org.slug,
  m.role                                       as rol,
  m.status                                     as membresia,
  org.status                                   as estado_empresa,
  org.kind                                     as tipo,
  org.id                                       as organization_id
from organization_memberships m
join organizations org on org.id = m.organization_id
join auth.users u      on u.id  = m.user_id
join objetivo o        on lower(u.email) = o.email
order by m.is_primary desc, m.created_at;
```

La empresa marcada con **★** es donde aterriza al entrar; el enganche elige con
`order by is_primary desc, created_at asc limit 1` entre las membresías
**activas**. A las demás se llega con el selector de empresa, arriba a la
izquierda.

Tres resultados que explican un fallo:

- **cero filas** → no pertenece a ninguna empresa (bloque 3);
- **ninguna activa** → entra y no ve nada (bloque 3, el mismo `insert … on conflict`);
- **ninguna marcada ★** → aterriza en la que salga primero por fecha, que es el
  azar disfrazado de comportamiento.

---

## 3 · Darle la membresía que le falta

Cambia el correo, el slug de la empresa y el rol. Roles válidos: `owner`,
`admin`, `manager`, `operations`, `cashier`, `seller`, `partner`, `superadmin`.

```sql
begin;

with objetivo as (
  select
    (select id from auth.users     where lower(email) = lower('demopresentaciones@havelgo.com')) as user_id,
    (select id from organizations  where slug = 'havelgo-demo-presentaciones')                   as org_id,
    'owner'::text as rol
)
-- Hay un índice único parcial: UN solo primario por persona. Quitar la marca
-- vieja tiene que ocurrir ANTES, y en su propia sentencia, o la siguiente
-- choca contra el índice.
update organization_memberships m
   set is_primary = false
  from objetivo o
 where m.user_id = o.user_id
   and m.organization_id is distinct from o.org_id
   and m.is_primary;

with objetivo as (
  select
    (select id from auth.users     where lower(email) = lower('demopresentaciones@havelgo.com')) as user_id,
    (select id from organizations  where slug = 'havelgo-demo-presentaciones')                   as org_id,
    'owner'::text as rol
)
insert into organization_memberships (user_id, organization_id, role, status, is_primary)
select o.user_id, o.org_id, o.rol, 'active', true
  from objetivo o
 where o.user_id is not null and o.org_id is not null
on conflict (user_id, organization_id) do update
   set role = excluded.role, status = 'active', is_primary = true;

commit;
```

**Antes de `commit`, comprueba.** Si el `insert` dice `INSERT 0 0`, uno de los
dos `select` volvió vacío —correo mal escrito o slug que no existe— y no se hizo
nada. Los slugs que hay:

```sql
select name, slug, kind, status from organizations where kind = 'tenant' order by name;
```

> `is_primary = true` mueve **dónde aterriza esa persona al entrar**. Si el
> correo es el tuyo y la empresa es la de demostración, la próxima vez entrarás
> a la demo en vez de a tu operación. Para eso está el selector: da la membresía
> con `is_primary = false` y cambia de empresa desde la aplicación.

---

## 4 · Confirmar un email a mano

Esto sí es seguro desde SQL: es una fecha, no una credencial. Mientras esté sin
confirmar, el acceso se rechaza aunque la contraseña sea la correcta.

```sql
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at         = now()
 where lower(email) = lower('demopresentaciones@havelgo.com')
   and email_confirmed_at is null;
```

---

## 5 · La contraseña, y por qué no va aquí

**La recomendación es no hacerlo en SQL.** No por ceremonia: la contraseña vive
en `auth.users` pero quien la interpreta es GoTrue, que además lleva su propia
contabilidad —identidades, sesiones abiertas, registro de auditoría, política de
contraseñas—. Escribiendo el hash a mano se cambia la mitad que se ve y se deja
la otra como estaba. Una cuenta a medias que parece funcionar es peor que una
que no entra, porque el fallo aparece después y en otro sitio.

**El camino sin terminal, dos clics, en el mismo panel:**

> **Authentication → Users**
>
> - ¿No existe? → **Add user** → *Create new user*, con **Auto Confirm User**
>   marcado. Luego vuelve al bloque 3 para darle la membresía.
> - ¿Existe? → los tres puntos de su fila → **Reset password** (manda correo) o
>   **Send magic link**. Si el dominio no recibe correo —`.demo.local` no existe
>   a propósito— borra la cuenta y créala de nuevo con *Add user*, que deja poner
>   la contraseña ahí mismo.

Eso hace lo mismo que `onboard-user.mjs`, con la ventaja de que lo hace GoTrue.

### Si no tienes acceso al buzón de esa cuenta

*Reset password* y *Send magic link* mandan un correo: sin buzón no sirven.
Quedan tres caminos, y no son igual de buenos.

**1 · El recomendado: no rescates esa dirección, haz una nueva.**

Una cuenta de demostración no tiene por qué ser una dirección concreta. En
*Authentication → Users → Add user* se escribe la contraseña **ahí mismo**, sin
correo de por medio: marca **Auto Confirm User** y ya está. Luego el bloque 3 de
arriba le da la membresía. Dos minutos, cero riesgo.

Sirve cualquier dirección que no exista de verdad —`demo@havelgo-demo.local`—
porque nunca va a recibir nada.

**2 · NO borres la cuenta para recrearla.**

Es la salida que parece obvia y es la cara. `auth.users` tiene **62 claves
foráneas** apuntándole: tres borran en cascada (membresías, notificaciones,
acuses de documentos) y **las otras 59 ponen el campo a NULL**. Esos campos son
`created_by`, `approved_by`, `checked_in_by`, `user_id` en cobros, movimientos
de caja y registro de auditoría.

O sea: borrar la cuenta no borra lo que hizo — le quita el autor. El historial
queda entero y anónimo, y eso no se deshace.

**3 · Ponerle la contraseña desde SQL.**

Si de verdad necesitas **esa** dirección y no tienes su buzón, este es el camino
que queda. Abajo está, con lo que se acepta al usarlo.

<details>
<summary>El atajo en SQL, si aun así lo prefieres</summary>

Funciona, y conviene saber qué se está aceptando: no valida la fuerza de la
contraseña, no cierra las sesiones ya abiertas, no deja rastro en la auditoría
de Auth, y depende de que el algoritmo siga siendo bcrypt — el día que cambie,
esta orden deja de servir sin avisar.

```sql
-- ci:skip — `extensions.crypt` y `auth.sessions` viven en Supabase, no en el
-- Postgres del CI, así que este bloque no se puede ejecutar allí.
update auth.users
   set encrypted_password = extensions.crypt('PonAquiUnaClaveLarga', extensions.gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at         = now()
 where lower(email) = lower('demopresentaciones@havelgo.com');

-- GoTrue cierra las sesiones abiertas al cambiar una contraseña; escribiendo el
-- hash a mano, no. Sin esto, una sesión anterior sigue viva con la clave vieja
-- —que es justo lo que se quería revocar—.
delete from auth.sessions
 where user_id = (select id from auth.users
                   where lower(email) = lower('demopresentaciones@havelgo.com'));
```

Si el `update` dice `UPDATE 0`, la cuenta no existe: no la crees con un
`insert` a mano en `auth.users`. Ahí faltan la fila de `auth.identities` y
media docena de campos que GoTrue rellena, y el resultado es justo la cuenta a
medias de la que hablaba arriba. Para crear, el panel.

**Y la clave queda escrita en el historial del editor SQL**, que es de todo el
que entre al proyecto. Bórrala de la pestaña cuando termines.

</details>

---

## 6 · Los datos de demostración no se siembran desde aquí

La empresa de demostración no son cuatro filas: son catálogo, clientes,
reservas, salidas, cobros, comisiones, caja, almacén y contabilidad, con
dependencias entre sí —una reserva cuelga de una salida, que cuelga de una
modalidad, que cuelga de un producto—. Eso lo resuelve el sembrador leyendo lo
que va creando. Reescribirlo como SQL suelto sería una copia que envejece a la
primera migración.

Lo que sí se contesta desde aquí es si **ya está sembrada**:

```sql
select org.name, org.slug,
       (select count(*) from product  p where p.organization_id = org.id) as productos,
       (select count(*) from booking  b where b.organization_id = org.id) as reservas,
       (select count(*) from customer c where c.organization_id = org.id) as clientes
from organizations org
where org.metadata ->> 'demo' = 'true'
   or org.name ilike '%demostraci%'
order by org.name;
```

- **Sale con productos y reservas** → la demo ya existe. Sólo falta que la
  cuenta tenga membresía (bloque 3) y contraseña (apartado 5).
- **No sale nada** → hay que ejecutar `npm run seed:demo-presentation` una vez,
  desde donde haya terminal. Es lo único de esta guía que la necesita.

---

## Resumen

| Síntoma | Dónde |
| --- | --- |
| «Email o contraseña incorrectos» | bloque 1 — decide si existe |
| Entra pero no ve nada | bloque 2 y 3 — membresía |
| Entra a la empresa equivocada | bloque 3 — la marca ★ |
| Dice que la contraseña es correcta y no pasa | bloque 1, `email_confirmado` → bloque 4 |
| Hay que crear la cuenta | apartado 5 — el panel, no SQL |
| La demo está vacía | bloque 6 |

---

## Esto no es documentación de fe

Los bloques de esta página **se ejecutan** en cada CI, contra un Postgres real
con todas las migraciones aplicadas: `supabase/tests/sql_playbook.test.sql`.

No comprueba sólo que corran. Comprueba que hacen lo que aquí se promete: que
buscar el correo en mayúsculas encuentra la cuenta, que la ★ del bloque 2 es la
misma empresa que abriría la sesión, que el bloque 3 no borra la membresía de la
empresa real y se puede repetir sin duplicar, que un slug inexistente no escribe
nada, y que el bloque 4 no vuelve a mover una fecha ya puesta.

Y comprueba el porqué del orden del bloque 3: intentar el segundo primario sin
desmarcar el primero **tiene** que chocar contra el índice. El día que una
migración cambie una de estas tablas, lo dirá el CI y no el editor de alguien
que ya estaba teniendo un mal día.
