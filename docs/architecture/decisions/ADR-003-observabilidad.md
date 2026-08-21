# ADR-003 — La observabilidad es funcionalidad P0, no una mejora

- **Estado:** Propuesta
- **Fecha:** 2026-08-20

## Contexto

En producción **no existe observabilidad alguna**:

- `instrumentation.ts` carga el logger estructurado sólo si `NEXT_RUNTIME === 'nodejs'`; el runtime es Cloudflare Workers, así que **nunca se ejecuta**. 395 líneas de logger son código muerto en producción.
- 287 llamadas `console.*` sin estructura ni correlación de petición.
- Sin Sentry, sin métricas, sin trazas, sin alertas, **sin health check**.
- `audit_log` de negocio existe y está bien diseñado, pero sus fallos se tragan (`SEC-009`): una impersonación o un reembolso pueden completarse sin dejar rastro.
- El asiento contable es best-effort sin cola de reintento (`BIZ-003`): los libros pueden descuadrar en silencio.

A la pregunta *"si producción falla a las 3:00 AM, ¿sabemos qué pasó?"*, la respuesta hoy es **no**.

## Decisión

La observabilidad se trata como requisito P0 de la misma categoría que la autorización, y es **gate de despliegue**:

1. **Error monitoring** (Sentry) en servidor y cliente, con release y sourcemaps.
2. **Logs estructurados** con `request_id`, `user_id`, `organization_id`, operación, duración y resultado. **Sin PII, sin importes en claro cuando no sean necesarios.**
3. **Health check** (`/api/health`) que verifique aplicación, base de datos, storage e integraciones críticas.
4. **Métricas de negocio**, no sólo técnicas: ventas, sobreventas evitadas, pagos fallidos, asientos fallidos, drafts reconciliados.
5. **Alertas sobre SLO**, no sobre eventos sueltos.
6. **Separación estricta** entre *application logs* (efímeros, técnicos) y *business audit log* (persistente, con actor, acción, entidad, antes, después y timestamp).
7. **El audit log deja de fallar en silencio**: severidad `critical`/`warning` aborta la operación si no puede escribirse. `audit_log` es insert-only a nivel de base de datos.

## Consecuencias

- Coste real de implementación y una dependencia externa más (Sentry).
- A cambio: un incidente en producción deja de ser una investigación arqueológica sobre logs de texto plano.
- Sin esto, el nivel de madurez del proyecto **no puede pasar de Level 2**, con independencia de lo correcto que sea el código.
