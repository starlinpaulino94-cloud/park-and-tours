import "server-only";
import { tenantQuery, type TenantContext } from "@/lib/tenant";
import { companyTimeZone } from "@/lib/time";
import { limitesConsulta, normalizarPeriodo, diaLocal } from "@/lib/report";
import { cerrarDia, type CierreDia } from "@/lib/cierre-dia";

/**
 * El cierre del día, fuera de la ruta HTTP.
 *
 * Lee las cinco cosas que componen la jornada y se las da al dominio puro de
 * `cierre-dia.ts`, que es quien decide. Aquí no se calcula nada: si mañana hay
 * que cambiar cómo se cuadra la caja, se cambia en un módulo con pruebas y no
 * dentro de un `GET`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DÍA ES EL DE LA EMPRESA, NO EL DEL SERVIDOR
 *
 * El proceso corre en UTC. Un cobro de las 21:00 en Santo Domingo son las 01:00
 * UTC del día siguiente: cortando en UTC, la venta de la tarde se le achaca al
 * día de mañana y el cierre de hoy sale corto sin que nada lo avise. El rango
 * sale de `limitesConsulta`, el mismo semiabierto y en la zona de la empresa
 * que usan todos los listados.
 */

/** Tope por tabla: un cierre es de UN día, no un volcado del histórico. */
const TOPE = 1000;

/**
 * UN CIERRE ES DE UN DÍA, Y ESO HAY QUE COMPROBARLO AQUÍ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA
 *
 * Esto decía «una fecha ilegible cae en hoy: `normalizarPeriodo` ya decide eso»,
 * y no era verdad. `fecha || hoy` solo cae en hoy cuando la fecha viene VACÍA;
 * una cadena con contenido pero ilegible —`?date=hoy`, `?date=10/04/2026`, un
 * dedazo— es «truthy» y pasa de largo. Y `normalizarPeriodo`, al no entender
 * ninguno de los dos extremos, hace lo correcto PARA UN REPORTE: devuelve **el
 * mes en curso**.
 *
 * O sea que la ruta —que pasa `?date=` tal cual, sin validar— devolvía un
 * documento titulado «cierre del 1 de abril» con un MES de ventas, de cobros y
 * de cajas dentro, cuadrando el efectivo de treinta días contra las sesiones de
 * treinta días. Con toda la pinta de un cierre bueno, y firmable.
 *
 * El mes en curso no es un fallo de `normalizarPeriodo`: es su respuesta correcta
 * a «no me diste fechas». Lo que está mal es preguntárselo así desde un cierre
 * DIARIO, y por eso la comprobación vive aquí.
 */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export interface CierreConMeta extends CierreDia {
  /** La zona en la que se cortó el día, para que el papel lo pueda decir. */
  timezone: string;
  /** Verdadero si alguna tabla llegó al tope y el documento está recortado. */
  recortado: boolean;
}

export async function cierreDelDia(
  ctx: TenantContext,
  fecha?: string | null,
): Promise<CierreConMeta> {
  const tz = companyTimeZone(ctx.company as { timezone?: string | null } | null);
  const hoy = diaLocal(new Date(), tz);
  // Ilegible o ausente, HOY. Y el mismo día en los dos extremos, que es lo que
  // hace que el período sea un día y no un rango.
  const pedido = fecha && DIA.test(fecha) ? fecha : hoy;
  const periodo = normalizarPeriodo(pedido, pedido, new Date(), tz);
  const rango = limitesConsulta(periodo, tz);

  const enElDia = (campo: string) => ({ [campo]: rango });

  const [salidas, ventas, cobros, sesionesCaja, incidencias] = await Promise.all([
    tenantQuery<Record<string, unknown>>(ctx.companyId, "departure", {
      _filter: enElDia("departure_at"), _limit: TOPE, _sort: { departure_at: "asc" },
    }),
    tenantQuery<Record<string, unknown>>(ctx.companyId, "sales_order", {
      _filter: enElDia("order_date"), _limit: TOPE, _sort: { order_date: "asc" },
    }),
    tenantQuery<Record<string, unknown>>(ctx.companyId, "payment", {
      _filter: enElDia("paid_at"), _limit: TOPE, _sort: { paid_at: "asc" },
    }),
    // Por `opened_at`: la caja pertenece al día en que se abrió, aunque se
    // cierre pasada la medianoche. Por `closed_at` se perdería entera la caja
    // que cerró a las 00:30, que es justo la de la noche que hay que cuadrar.
    tenantQuery<Record<string, unknown>>(ctx.companyId, "cash_session", {
      _filter: enElDia("opened_at"), _limit: TOPE, _sort: { opened_at: "asc" },
    }),
    tenantQuery<Record<string, unknown>>(ctx.companyId, "incident", {
      _filter: enElDia("occurred_at"), _limit: TOPE, _sort: { occurred_at: "asc" },
    }),
  ]);

  const documento = cerrarDia({
    fecha: periodo.desde,
    salidas: salidas as never,
    ventas: ventas as never,
    cobros: cobros as never,
    sesionesCaja: sesionesCaja as never,
    incidencias: incidencias as never,
  });

  // Si alguna lista llegó al tope, el documento NO es el día entero. Se dice,
  // en vez de imprimir un total incompleto con cara de completo.
  const recortado = [salidas, ventas, cobros, sesionesCaja, incidencias]
    .some((filas) => filas.length >= TOPE);

  return { ...documento, timezone: tz, recortado };
}
