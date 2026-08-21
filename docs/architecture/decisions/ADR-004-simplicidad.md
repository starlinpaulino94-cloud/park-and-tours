# ADR-004 — La arquitectura más simple que sostenga la escala requerida

- **Estado:** Aceptada
- **Fecha:** 2026-08-20

## Contexto

Un ERP con 77 recursos, 95 páginas y 13 módulos invita a proponer arquitecturas que *parecen* profesionales: microservicios por dominio, event sourcing para la contabilidad, CQRS para los informes, Kafka para la integración, Kubernetes para el despliegue, Clean Architecture o DDD táctico completo.

Nada de eso resuelve ninguno de los 35 hallazgos de esta auditoría.

## Decisión

**Monolito modular sobre Next.js + Postgres.**

Explícitamente **NO** se adopta, salvo que aparezca una razón demostrable y medida:

| Tecnología / patrón | Por qué no |
|---|---|
| Microservicios | Los problemas son de integridad transaccional. Partir en servicios los **empeora**: convierte transacciones locales en sagas distribuidas, que es justo lo que ya duele con Totalum |
| Kafka / event bus | No hay ningún consumidor que lo justifique. Una tabla de outbox cubre el reintento de asientos |
| Kubernetes | Serverless gestionado cubre la escala objetivo prevista |
| Event sourcing | La contabilidad de partida doble **ya es** un registro append-only. Duplicar el concepto añade complejidad sin garantía nueva |
| CQRS | Las agregaciones de informes se resuelven con índices y vistas materializadas |
| Redis | Sólo si el rate limiting distribuido lo exige — y entonces basta Cloudflare Rate Limiting o Upstash |
| Clean Architecture / Hexagonal completa | La separación en cuatro capas ya existe y se respeta. Formalizarla con puertos y adaptadores añadiría indirección sin cerrar ningún hallazgo |

## Lo que sí se refuerza

- **Módulos de dominio con frontera clara** dentro del monolito (venta, cupos, finanzas, operación, parque, comercio, mantenimiento, equipo).
- **`tenant.ts` como único punto de acceso a datos**, sin excepciones (ADR-002).
- **Transacciones de base de datos** en lugar de sagas manuales, donde el motor lo permita.
- **Trabajo asíncrono** sólo donde hay evidencia de que no cabe en una petición: liquidaciones, informes, importaciones, emails.

## Consecuencias

- Menos partes móviles que operar, que es exactamente lo que necesita un equipo que hoy no tiene observabilidad ni rollback.
- Si en el futuro un módulo demuestra —con métricas— que necesita escalar o desplegarse por separado, la frontera modular permite extraerlo. Extraer es fácil; volver a juntar, no.
