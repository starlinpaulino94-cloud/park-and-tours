# Scalability Audit

Fecha: 2026-08-21.

## Resultado

TARGET SCALE VALIDATED: NO.

No existen pruebas de carga, stress, spike o soak verificadas. Cualquier afirmacion de escala debe marcarse UNVERIFIED.

## Supuestos De Escala Para Planificacion

| Escenario | Usuarios | Concurrentes | Comentario |
|---|---:|---:|---|
| S | 1k | 50 | MVP operativo |
| M | 10k | 300 | SaaS regional |
| L | 100k | 2k | requiere mediciones serias |
| XL | 1M | 10k+ | fuera de alcance actual |

## Bottlenecks Conocidos

### SCAL-001 — Backend Totalum/default limita control de DB

Severity: P1.

Evidence: `DATA_BACKEND` cae a `totalum`; muchas llamadas directas a `totalumSdk`.

Impacto: dificil optimizar queries, transacciones, indices y pooling.

### SCAL-002 — Supabase service-role transition sin pooling/limits validados

Severity: P1.

Evidence: `src/lib/supabase/data-provider.ts` usa SDK directo; no hay prueba de conexiones ni pooling.

Impacto: serverless + Postgres puede saturar conexiones si se despliega sin pooler.

### SCAL-003 — Queries y CRUD generico requieren paginacion/EXPLAIN

Severity: P2.

Evidence: `tenantQuery` y `ResourcePage` soportan limites, pero no hay plan de EXPLAIN con datos reales para todos los listados.

Impacto: tablas grandes pueden degradar dashboard/portal.

### SCAL-004 — No hay colas/backpressure

Severity: P2.

Evidence: no se detectaron queues/workers.

Impacto: reportes, imports, exports, emails masivos y ETL dentro de request saturarian runtime.

### SCAL-005 — Upload procesa multipart antes de limitar por infraestructura

Severity: P3.

Evidence: `/api/storage/upload` llama `req.formData()` antes de validacion de size.

Impacto: cuerpos grandes consumen memoria antes del rechazo.

## Performance Budget Propuesto Inicial

- API p95 lectura dashboard: < 800 ms en escenario S.
- API p95 mutaciones criticas: < 1200 ms en escenario S.
- Error rate: < 1% 5xx.
- LCP dashboard: < 2.5 s en desktop moderno.
- DB p95 queries criticas: < 100 ms con indices.

Estos valores son objetivos iniciales, no resultados medidos.

## Load Test Requerido

Flujos minimos:
- Login + dashboard.
- Listado reservas.
- Crear reserva con cupo.
- Registrar pago.
- Portal partner catalogo/reservas.
- Upload privado pequeno.

Metricas:
- RPS, concurrent users, p50/p95/p99, error rate, DB CPU, conexiones, memoria.

## Gate Scalability

NO PASS. El sistema puede operar como beta/controlado, pero no tiene escala objetivo validada.
