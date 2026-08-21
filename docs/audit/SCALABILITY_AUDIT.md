# SCALABILITY_AUDIT.md — Park & Tours

> Fecha: 2026-08-20.
> **No se ejecutaron pruebas de carga.** No hay entorno desplegado accesible ni datos representativos. Todo lo cuantitativo de este documento es **análisis estático + supuestos declarados**, marcado **UNVERIFIED**. Ninguna conclusión de este informe debe usarse para declarar Level 5.

## Capacidad objetivo: no está definida

No consta en el repositorio ningún número de usuarios, reservas/día, RPS ni tamaño de datos. Sin eso, la pregunta *"¿escala?"* no tiene respuesta. Se proponen escenarios **como supuestos**, para poder razonar:

| Escenario | Tenants | Usuarios concurrentes | Reservas/día | Filas `booking` a 3 años | RPS pico |
|---|---:|---:|---:|---:|---:|
| **S** — piloto | 5 | 20 | 200 | ~200 k | 5 |
| **M** — comercial | 50 | 200 | 3 000 | ~3 M | 50 |
| **L** — escala | 500 | 2 000 | 30 000 | ~30 M | 500 |
| **XL** | 5 000 | 20 000 | 300 000 | ~300 M | 5 000 |

> **Estos números son supuestos del auditor, no requisitos del negocio.** Definirlos es la primera tarea de la Fase 16 y debe hacerlo el responsable de producto.

## Presupuesto de rendimiento: no está definido

Tampoco hay SLO. Propuesta inicial para un ERP operativo (a validar):

| Métrica | Objetivo propuesto |
|---|---|
| API p50 / p95 / p99 | 150 ms / 500 ms / 1 500 ms |
| Venta completa (POST /api/orders) p95 | 2 000 ms |
| Tasa de error 5xx | < 0,5 % |
| Disponibilidad mensual | 99,5 % (piloto) → 99,9 % (comercial) |
| LCP dashboard | < 2,5 s |

---

## Cuello de botella nº 1: el modelo de acceso a datos (P0 para escala)

**Una venta hace entre 40 y 60 llamadas HTTP secuenciales a Totalum.**

Traza de `createOrderWithBookings` para una orden de 3 ítems:
```
1  assertCapacity → recalculateDeparture → 2 queries (departure + hasta 1000 bookings)
                                         → 1 update
   × 3 salidas                            = 9 llamadas
2  crear order                            = 1
3  por ítem: departure, resolvePrice(n),  product, resolveCost, uniqueCode ×2,
   booking, voucher, pickup, comisiones(3-5), recalculate ×2
                                          ≈ 15 × 3 = 45
4  receivable + promoción                 = 2
                                          ────────────
                                            ~57 round-trips
```

A 30 ms por llamada son **~1,7 s de latencia de red pura**, en serie, con **cero timeouts** (`BIZ-005`). En Cloudflare Workers hay límites de subrequests y de CPU por invocación; una orden grande puede acercarse a ellos.

**Punto de ruptura estimado (UNVERIFIED): escenario S–M.** No es un problema de "muchos usuarios": es un problema de **una sola venta**.

**Ninguna cantidad de réplicas de aplicación lo arregla**, porque el cuello es el número de viajes al almacén, no la CPU. Sólo se resuelve con operaciones por lote y transacciones — es decir, con Postgres (Opción A).

## Cuello de botella nº 2: recálculo de ocupación en memoria (P1)

`recalculateDeparture` se ejecuta **2 veces por ítem** durante una venta y trae hasta **1 000 reservas** cada vez para sumarlas en JavaScript (`DB-005`).

| Reservas activas en la salida | Comportamiento |
|---|---|
| < 100 | Funciona |
| 100–1 000 | Lento: ~1 MB de JSON por recálculo, ×2 por ítem |
| **> 1 000** | **Cuenta de menos en silencio → sobreventa** |

Un parque con entrada diaria supera 1 000 con normalidad. **Esto es un fallo de corrección disfrazado de problema de rendimiento**, y aparece exactamente cuando el negocio va bien.

## Cuello de botella nº 3: `Cache-Control: no-store` global (P1)

`next.config.ts` aplica `no-cache, no-store, must-revalidate` a **`/:path*`** — toda ruta, incluidos JS, CSS y fuentes.

**Efecto:** ni el navegador ni el CDN de Cloudflare cachean nada. Cada navegación descarga todo el bundle. Con 2 000 usuarios concurrentes (escenario L) esto multiplica el ancho de banda y el coste por un factor grande, y empeora el LCP para todos.

**Solución:** `no-store` sólo en `/api/*` y rutas autenticadas; estáticos con `immutable, max-age=31536000` (Next.js ya versiona sus assets por hash).

## Cuello de botella nº 4: coste por petición del layout (P2)

`src/app/dashboard/layout.tsx` ejecuta, **en cada navegación de página**:
- `getTenantContext()` → 1 consulta de usuario (+1 si hay impersonación)
- `loadBadges()` → 3 `tenantCount` en paralelo

= **4–5 consultas antes de renderizar cualquier página**. Los contadores son útiles, pero no necesitan ser exactos ni síncronos. Cachear 30–60 s o cargarlos del cliente tras el primer render.

## Cuello de botella nº 5: sin pooling ni concurrencia controlada (P1 futuro)

Hoy no aplica (Totalum es HTTP). **Al migrar a Postgres se convierte en el riesgo nº 1 de la migración**: un runtime serverless que abre una conexión por invocación agota `max_connections` (por defecto ~60 en instancias pequeñas de Supabase) mucho antes de agotar la CPU.

> Funciona con 20 usuarios y cae con 2 000, sin aviso previo.

**Obligatorio en el diseño del cutover:** usar el pooler de Supabase (PgBouncer, modo transaction) y **medir** conexiones activas bajo carga antes de abrir a usuarios.

## Sin trabajo asíncrono (P1)

No hay colas ni workers. Se ejecutan **dentro de la petición HTTP** operaciones que no deberían:
- `/api/settlements/generate` — itera comisiones de un periodo
- `/api/commissions/bulk` — operación masiva
- `/api/departures/generate` — genera salidas recurrentes
- `/api/setup/demo` — siembra cientos de registros
- `/api/reports/*` — agregaciones

Con volumen real, cualquiera de éstas supera el tiempo de invocación y **falla a medias** — sin transacción y sin idempotencia, dejando estado inconsistente.

## Backpressure (Fase 20)

**No existe ningún mecanismo.** Sin colas, sin rate limiting efectivo (`SEC-007`), sin circuit breaker (`BIZ-005`), la degradación no es controlada: bajo saturación de Totalum, las peticiones se acumulan hasta que el Worker agota recursos y **todo el tenant deja de responder a la vez** — incluido el check-in en la puerta del parque.

Prioridad de degradación que debería existir y no existe:
```
P0 sigue vivo:   check-in, venta en POS
P1 degrada:      dashboard, informes
P2 se encola:    liquidaciones, importaciones, emails
P3 se rechaza:   seeds, exportaciones masivas
```

## Punto de ruptura estimado — UNVERIFIED

| Escenario | Veredicto estimado | Primer límite en alcanzarse |
|---|---|---|
| **S** (5 tenants, 20 concurrentes) | ✅ Probablemente funciona | — |
| **M** (50 tenants, 200 concurrentes) | ⚠️ Latencia de venta degradada | N+1 (~57 llamadas/venta) |
| **L** (500 tenants, 2 000 concurrentes) | ❌ No | N+1 + `no-store` + sin cache + límites de Worker |
| **XL** | ❌ No | Requiere rediseño del acceso a datos |

**Estas estimaciones no sustituyen a una prueba de carga.** Son hipótesis derivadas del conteo de llamadas por operación, y deben confirmarse con k6/Artillery antes de cualquier compromiso de escala.

## Coste (Fase 41) — modelo grueso, UNVERIFIED

| Partida | S | M | L |
|---|---|---|---|
| Hosting (Workers/Vercel) | ~$5–20 | ~$50–200 | ~$500–2 000 |
| Base de datos | Totalum: **precio no consta en el repositorio** · Supabase: $25 → $600+ | | |
| Ancho de banda | Inflado ×N por `no-store` | | |
| Stripe | % de la suscripción | | |
| Email / observabilidad | $0 (no existen) | ~$50 | ~$300 |

**Riesgo de coste no modelado:** Totalum cobra por API (modelo no documentado en el repositorio). Con ~57 llamadas por venta, el coste por transacción puede escalar de forma no lineal. **Verificar el modelo de precios del proveedor es una tarea pendiente y potencialmente decisiva para la Opción A vs B.**

## Plan de escala recomendado (resumen)

1. **Definir capacidad objetivo y SLO reales.** Sin esto, nada más es medible.
2. **Migrar a Postgres** — habilita lote, transacciones e índices (Opción A).
3. **Colapsar el N+1**: una transacción por venta, inserciones por lote.
4. **Agregar en base de datos**, no en JavaScript (`DB-005`).
5. **Arreglar el cacheo** de estáticos.
6. **Pooling** desde el primer día del cutover, con medición.
7. **Cola** para liquidaciones, informes e importaciones.
8. **Medir**: k6 con perfiles load / stress / spike / soak, y sólo entonces publicar `LOAD_TEST_REPORT.md`.

> Escalar sin haber medido es adivinar. Este documento identifica dónde mirar; no afirma dónde está el límite.
