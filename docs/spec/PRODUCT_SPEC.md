# Product Spec — Producto Real Auditado

Fecha: 2026-08-21.

Estado: auditoria inicial, sin reconstruccion.

## Problema

Park & Tours es una plataforma SaaS multi-tenant para operadores turisticos/parques que necesitan vender tours, gestionar reservas, salidas, pagos, caja, partners B2B, comisiones, pickups, catalogo, clientes, operaciones, inventario/parque/mantenimiento y administracion interna.

La aplicacion intenta reemplazar gradualmente un backend Totalum por Supabase/Postgres, conservando operacion actual mientras se valida el corte.

## Evidencia de producto real

- Next.js App Router con rutas en `src/app`.
- Dashboard interno protegido en `src/app/dashboard/layout.tsx`.
- Portal partner en `src/app/portal/layout.tsx`.
- Superadmin en `src/app/superadmin/layout.tsx`.
- APIs en `src/app/api`.
- CRUD generico en `src/app/api/erp/[resource]` y `src/components/tf/resource-page.tsx`.
- Backend actual por defecto: `DATA_BACKEND` cae a `totalum` en `src/lib/data-backend.ts`.
- Backend Supabase existe detras de flag en `src/lib/supabase/data-provider.ts`.
- Migraciones Supabase versionadas en `supabase/migrations/0001` a `0017`.
- ETL/reconciliacion de datos en `scripts/migrate`.

## Usuarios

- Superadmin de plataforma.
- Owner/admin/manager de una empresa operadora.
- Operaciones/caja/vendedores.
- Partners/agencias B2B.
- Staff operativo.
- Clientes finales indirectos, representados como registros, no como portal cliente completo verificado.

## Roles

Roles detectados en `src/lib/tenant.ts` y migraciones Supabase:

- `superadmin`
- `owner`
- `admin`
- `manager`
- `operations`
- `cashier`
- `seller`
- `partner`

## Casos De Uso Por Actor

| Actor | Casos de uso existentes | Estado |
|---|---|---|
| Superadmin | empresas, planes, auditoria, impersonacion | PARTIAL/WORKING segun ruta |
| Admin/owner | configuracion, equipo, catalogo, ventas, finanzas, operaciones | PARTIAL |
| Seller/cashier | POS, reservas, pagos, caja | PARTIAL por idempotencia/transacciones |
| Operations | salidas, check-in, pickups, recursos | PARTIAL |
| Partner | portal B2B, catalogo, reservas, liquidaciones | PARTIAL/WORKING |

## Datos Que Maneja

- Empresas/tenants, partners y relaciones.
- Usuarios y memberships.
- Catalogo: productos, modalidades, reglas de precio, promociones.
- Ventas: ordenes, reservas, participantes, vouchers.
- Finanzas: pagos, caja, movimientos, receivables, payables, comisiones, liquidaciones, ledger.
- Operaciones: salidas, pickups, vehiculos, staff, rutas.
- Parque/mantenimiento/inventario: atracciones, activos, inspecciones, ordenes, inventario, stock.
- Documentos/uploads en Supabase Storage.
- Eventos Stripe y suscripciones.
- Audit logs.

## Operaciones Criticas

| Operacion | Riesgo |
|---|---|
| Crear orden/reserva | sobreventa, duplicados, inconsistencias parciales |
| Registrar pago/reembolso | doble cobro, saldos incorrectos, ledger divergente |
| Check-in/voucher | acceso indebido o doble redencion |
| Liquidaciones/comisiones | perdida de dinero por calculo incorrecto |
| Caja | movimientos duplicados o asociados a sesion incorrecta |
| Upload | exposicion de archivos o escritura en entidad no autorizada |
| Stripe checkout/webhook | metadata manipulada, actualizacion de tenant incorrecto |
| Impersonacion | abuso administrativo si no audita todo |
| Migracion Totalum -> Supabase | perdida/fuga de datos, referencias rotas |

## Alcance Real

### Existe Y Debe Funcionar

- Login/session con Better Auth + Totalum.
- Dashboard multi-tenant basico.
- CRUD generico multi-tenant.
- POS/reservas/pagos/caja en Totalum.
- Portal partner con aislamiento aplicativo.
- Superadmin basico.
- Migracion de datos a Supabase ya reconciliada.

### Existe Pero Esta Incompleto

- Supabase como backend real de aplicacion.
- Supabase Auth/RLS con claims JWT.
- Transaccion atomica de reserva/cupo cableada al flujo principal.
- Idempotencia fuerte de pagos.
- Storage con autorizacion por recurso.
- Observabilidad productiva.
- Backups/restore/DR operativo.
- Tests E2E/integracion.
- Modulos parque/comercio/mantenimiento/equipo mas alla de CRUD.

### Planificado

- Cutover controlado a Supabase.
- Activar `SUPABASE_USE_RLS=true` tras memberships y claims.
- Migrar blobs a Supabase Storage.
- Vercel/CI/CD completo.
- Load/performance tests.

### Fuera De Alcance En Esta Auditoria

- Reescritura de arquitectura.
- Cambios funcionales.
- Nueva migracion destructiva.
- Activar RLS o Auth sin validar memberships.

## Inventario De Funcionalidades

| Feature | Ruta/archivo | Usuario | Datos | Criticidad | Estado |
|---|---|---|---|---|---|
| Login | `/login`, `src/lib/auth.ts` | todos | user/session | P0 | WORKING/PARTIAL |
| Dashboard | `/dashboard` | staff | tenant data | P0 | PARTIAL |
| POS | `/dashboard/pos` | seller/cashier | order/booking/payment | P0 | PARTIAL |
| Reservas | `/dashboard/reservas`, `booking-service.ts` | staff | booking/departure | P0 | PARTIAL |
| Pagos | `/api/payments` | seller/cashier | payment/cash/ledger | P0 | PARTIAL |
| Check-in | `/api/bookings/*/checkin` | operations | booking/voucher | P1 | PARTIAL |
| Portal B2B | `/portal` | partner | catalog/bookings/settlements | P1 | PARTIAL |
| Superadmin | `/superadmin` | superadmin | companies/plans/audit | P1 | PARTIAL |
| Stripe | `/api/stripe/*` | admin/public endpoint | subscriptions/events | P1 | PARTIAL |
| Upload | `/api/storage/upload` | authenticated | files/storage | P1 | PARTIAL |
| CRUD ERP | `/api/erp/[resource]` | staff | 77 recursos aprox. | P1-P3 | PARTIAL |
| Parque/mantenimiento/inventario | dashboard subrutas | staff | assets/stock/work orders | P2 | PARTIAL |
| Observabilidad | `backend-logger`, `console.log` | ops | logs | P1 | UNKNOWN |

## Notas De Verificacion

- `npm test` paso con 69 tests.
- `npm run check-types-errors` paso.
- No hay script `npm lint` en `package.json`.
- La migracion de datos fue reportada como reconciliada, pero esta auditoria no la re-ejecuto salvo backup solicitado por el usuario.
