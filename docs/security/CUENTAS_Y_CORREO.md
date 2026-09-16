# Cuentas del equipo: cómo entra alguien, y qué hay que configurar

Este documento explica el camino completo de una cuenta —invitación, aceptación
y recuperación— y la ÚNICA pieza que no está en el código: el remitente de
correo.

## Por qué se invita en vez de crear con contraseña

Hasta la ola 3, sumar a alguien al equipo exigía que el administrador le
inventara una contraseña y se la hiciera llegar. Eso tiene un coste que no se ve
hasta que hace falta:

- Otra persona conoce la clave con la que se cierran cajas y se anulan facturas,
  así que la bitácora —que existe para responder «¿quién hizo esto?»— deja de
  responderlo.
- La contraseña queda escrita en un chat para siempre.

Con la invitación, la persona recibe un correo, entra por un enlace de un solo
uso y pone una contraseña que nadie más ha visto.

El camino con contraseña **se queda** como segunda opción, porque hay casos
reales sin correo fiable: un cajero de temporada, una tablet compartida en la
puerta del parque. Deja de ser el primero que se ve, no desaparece.

## El camino, paso a paso

1. **Invitar** — `POST /api/team/invite`. Comprueba el plan (la invitación
   RESERVA plaza), pide a Supabase que mande el correo y crea la membresía con
   estado `pending`.
2. **Pendiente ≠ acceso** — solo las membresías activas resuelven inquilino. Si
   el correo acaba en la bandeja equivocada, quien lo reciba no entra a nada.
3. **Aceptar** — el enlace lleva a `/auth/callback`, que canjea el código por
   sesión y, solo entonces, activa las invitaciones pendientes de ESE usuario.
4. **Contraseña** — `/auth/establecer-clave`. La persona la elige y entra.

Recuperar acceso usa el mismo canal: `/login/recuperar` pide el enlace y
aterriza en las mismas dos pantallas.

## Lo que hay que configurar en Supabase

Dos cosas, las dos en el panel del proyecto. Sin ellas el sistema funciona, pero
los correos no salen o salen mal.

### 1. Remitente propio (SMTP)

`Project Settings → Authentication → SMTP Settings`.

El remitente por defecto de Supabase **es solo para desarrollo**: unos pocos
correos por hora y un dominio que no es el tuyo. Con eso no se invita a un
equipo de doce personas en una tarde.

Sirve cualquier proveedor con SMTP (Resend, SendGrid, Amazon SES, el correo de
Google Workspace de la empresa). Hay que dejar el remitente con el dominio
propio y, en el DNS de ese dominio, los registros SPF y DKIM que indique el
proveedor: sin ellos las invitaciones acaban en «no deseado», que se parece
mucho a «el sistema no funciona».

### 2. Plantillas en español

`Authentication → Emails`.

Las plantillas vienen en inglés. Las que importan aquí son **Invite user** y
**Reset password**; el enlace de cada una debe seguir siendo
`{{ .ConfirmationURL }}`, que es lo que apunta a `/auth/callback`.

### 3. URLs permitidas

`Authentication → URL Configuration`.

En `Redirect URLs` tienen que estar la dirección de producción y la de las
vistas previas, las dos terminadas en `/auth/callback`. Supabase rechaza
cualquier destino que no esté en esa lista — que es, por cierto, la segunda
barrera contra un enlace que quisiera llevar a otro sitio; la primera está en el
propio código (`safeNextPath`).

## Caducidad

El enlace de invitación y el de recuperación caducan (una hora por defecto,
configurable en el panel) y sirven **una sola vez**. Quien llega tarde ve el
motivo y puede pedir otro desde la pantalla de entrada, sin escribir a nadie.
