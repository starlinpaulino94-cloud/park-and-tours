import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { PORTAL_NAV } from "@/lib/nav";

/**
 * Contratos de código fuente.
 *
 * Estas reglas no se pueden comprobar renderizando una sola pantalla: son
 * invariantes de todo el shell administrativo ("el correo del usuario
 * autenticado solo aparece en su perfil", "las decisiones de aprobación pasan
 * por decide()"). Se verifican leyendo el código, de modo que una regresión en
 * cualquier módulo futuro rompa la suite en vez de pasar inadvertida.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const existe = (rel: string) => existsSync(path.join(ROOT, rel));
/** El fichero sin comentarios: una guarda no puede darse por cumplida por lo
 *  que un comentario MENCIONA, solo por lo que el código HACE. Varios bloques
 *  declaran el suyo; este es el de los que no. */
const sinComentariosDe = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
/**
 * El fichero SIN su cabecera de `import`.
 *
 * Para comparar el ORDEN de dos llamadas. Sin quitar los imports, `indexOf`
 * encuentra el nombre de la función en la línea que la importa y la guarda pasa
 * dijera lo que dijera el cuerpo. Ha mordido cuatro veces en esta rama; existe
 * para que no muerda una quinta.
 */
const cuerpoDe = (rel: string) =>
  sinComentariosDe(rel).replace(/^\s*import[\s\S]*?from\s+"[^"]+";\s*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("identidad del usuario — el correo solo vive en Mi perfil", () => {
  it("ShellUser no transporta el correo", () => {
    const source = read("src/components/tf/app-shell.tsx");
    expect(source).toMatch(/export interface ShellUser \{[\s\S]*?\}/);
    const shellUser = /export interface ShellUser \{([\s\S]*?)\n\}/.exec(source)![1];
    expect(shellUser).not.toMatch(/^\s*email\s*:/m);
  });

  it("ningún shell renderiza user.email", () => {
    for (const file of ["src/components/tf/app-shell.tsx", "src/components/tf/side-shell.tsx"]) {
      expect(read(file)).not.toContain("{user.email}");
    }
  });

  it("el menú de usuario muestra nombre, rol y empresa", () => {
    const source = read("src/components/tf/app-shell.tsx");
    expect(source).toContain("{user.name}");
    expect(source).toContain("{user.role}");
    expect(source).toContain("{user.companyName}");
  });

  it("la única pantalla que muestra ctx.email es /dashboard/perfil", () => {
    // `{ctx.email}` en JSX es presentación; `${ctx.email}` dentro de una
    // plantilla es un registro de auditoría o un log y sí es legítimo.
    const rendered = /(?<!\$)\{\s*(?:ctx|session)\??\.email\s*\}/;
    const offenders = walk(path.join(ROOT, "src/app"))
      .filter((file) => file.endsWith(".tsx") && rendered.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));

    expect(offenders).toEqual(["src/app/dashboard/perfil/page.tsx"]);
  });

  it("tampoco se pasa el correo del usuario a los componentes del shell", () => {
    const passed = /\bemail:\s*(?:ctx|session|user)\??\.email\b/;
    const offenders = walk(path.join(ROOT, "src/app"))
      .filter((file) => file.endsWith(".tsx") && passed.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });

  it("el contexto sigue exponiendo el correo para auditoría y perfil", () => {
    // La regla es de presentación, no de modelo: quitarlo del contexto rompería
    // la auditoría y los correos operativos de clientes y proveedores.
    expect(read("src/lib/supabase/auth-context.ts")).toContain("email: user.email");
  });

  it("un nombre vacío ya no se rellena con el correo", () => {
    const source = read("src/lib/supabase/auth-context.ts");
    expect(source).toContain("resolveDisplayName(user.name, user.email)");
    expect(source).not.toContain("name: user.name || user.email");
  });
});

describe("encabezado de Mi día", () => {
  const page = read("src/app/dashboard/inicio/mi-dia/page.tsx");

  it("el título es 'Mi día' y no lleva eyebrow ni descripción", () => {
    const headers = page.match(/<PageHeader[^>]*\/>/g) || [];
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header).toContain('title="Mi día"');
      expect(header).not.toContain("eyebrow");
      expect(header).not.toContain("description");
    }
  });

  it("no queda ningún saludo en el módulo", () => {
    /**
     * Esta comprobación prohibía `ctx.name` en CUALQUIER parte del módulo.
     * Cumplía su propósito —quitar el «Hola, Fulano» del encabezado— pero por
     * exceso: también prohibía pasar el nombre como propiedad a un diálogo, que
     * no es un saludo ni sale en el encabezado.
     *
     * Se acota a lo que de verdad defiende: que el nombre no se PINTE como texto
     * de la pantalla. Sigue siendo una prohibición, y más exacta: antes bastaba
     * con escribir el nombre de otra forma para esquivarla.
     */
    const files = walk(path.join(ROOT, "src/app/dashboard/inicio/mi-dia"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file}: saludo`).not.toMatch(/Hola,|Bienvenid/);
      // El nombre renderizado como texto visible, en cualquiera de sus formas.
      expect(source, `${file}: el nombre no se pinta en la pantalla`).not.toMatch(
        />\s*\{\s*(ctx|user)\.name\s*\}|\{\s*(ctx|user)\.name\s*\}\s*</
      );
    }
  });
});

describe("Panel ejecutivo", () => {
  it("el encabezado solo declara el título del módulo", () => {
    /**
     * El panel vive ahora en `_components/panel-empresa.tsx`: `page.tsx` pasó a
     * ser un componente de SERVIDOR que decide a dónde aterriza cada quien —el
     * rango más bajo del ERP va a su propio apartado— y que no podía serlo
     * mientras el panel entero fuera de cliente.
     */
    const page = read("src/app/dashboard/_components/panel-empresa.tsx");
    expect(page).toContain('title="Panel ejecutivo"');
    expect(page).not.toContain('eyebrow="Dirección"');
    expect(page).not.toContain("Todo lo que está pasando");
    expect(page).not.toContain("user.email");
  });

  it("no duplica Ventas de hoy ni usa mensajes motivacionales", () => {
    const page = read("src/app/dashboard/_components/panel-empresa.tsx");
    expect(page).not.toContain("Ventas de hoy");
    expect(page).not.toContain("empujar ventas");
  });

  it("la API del dashboard aplica permisos y periodo por zona horaria", () => {
    const route = read("src/app/api/dashboard/route.ts");
    expect(route).toContain("resolveDashboardPermissions");
    expect(route).toContain("resolveDashboardPeriod");
    expect(route).toContain("forcedSellerId");
    expect(route).toContain('rpc("dashboard_summary"');
    expect(route).not.toContain("MAX_PAGES");
    expect(route).not.toContain("PAGE = 1000");
    expect(route).not.toContain('tenantQuery<any>(ctx.companyId, "departure"');
  });

  it("el RPC del dashboard devuelve próximas salidas", () => {
    const migration = read("supabase/migrations/0024_dashboard_upcoming_departures_rpc.sql");
    expect(migration).toContain("upcoming_rows as");
    expect(migration).toContain("'upcoming_departures'");
    expect(migration).toContain("from departure d");
  });

  it("los cobros del RPC respetan los mismos filtros dimensionales que ventas", () => {
    const migration = read("supabase/migrations/0025_dashboard_filtered_collections.sql");
    expect(migration).toContain("left join booking pb on pb.id = p.booking_id");
    expect(migration).toContain("left join sales_order po on po.id = p.order_id");
    expect(migration).toContain("p_product_id is null or pb.product_id = p_product_id");
    expect(migration).toContain("p_branch_id is null or coalesce(pb.branch_id, po.branch_id) = p_branch_id");
    expect(migration).toContain("p_seller_id is null or coalesce(pb.seller_id, po.seller_id) = p_seller_id");
    expect(migration).toContain("p_channel is null or coalesce(pb.channel::text, po.channel::text) = p_channel");
  });

  it("A1 — series y ventas por canal no se filtran a roles sin acceso a ingresos", () => {
    const route = read("src/app/api/dashboard/route.ts");
    // El RPC siempre calcula series/by_channel; la capa API las oculta a quien no ve ingresos.
    expect(route).toContain("series: permissions.canViewRevenue ? asRows(summary?.series) : []");
    expect(route).toContain("by_channel: permissions.canViewRevenue ? asRows(summary?.by_channel) : []");
    // La UI no renderiza la sección de evolución/canales sin canViewRevenue.
    const page = read("src/app/dashboard/_components/panel-empresa.tsx");
    expect(page).toContain("data.permissions.canViewRevenue && (");
  });

  it("A2 — el margen de series y rankings es margen de contribución (resta comisión)", () => {
    const migration = read("supabase/migrations/0026_dashboard_exec_audit_high.sql");
    // Comisión variable atribuida por reserva y restada del margen en cada agregación.
    expect(migration).toContain("booking_commission as (");
    expect(migration).toContain("left join booking_commission bc on bc.booking_id = b.id");
    expect(migration).toContain("sale_base - cost_base - commission_base");
    // Ya no debe quedar ninguna definición de margen sin comisión.
    expect(migration).not.toMatch(/sum\(sale_base - cost_base\)/);
    expect(migration).not.toMatch(/sum\(b\.sale_base - b\.cost_base\)/);
  });

  it("A3 — los conteos financieros solo cuentan filas en moneda base y exponen las excluidas", () => {
    const migration = read("supabase/migrations/0026_dashboard_exec_audit_high.sql");
    expect(migration).toContain("count(*) filter (where amount_base is not null) as count");
    expect(migration).toContain("count(*) filter (where amount_base is null) as excluded_count");
    for (const key of ["commission_excluded_count", "receivable_excluded_count", "payable_excluded_count"]) {
      expect(migration).toContain(`'${key}'`);
    }
    // La API propaga los conteos excluidos hacia la UI.
    const route = read("src/app/api/dashboard/route.ts");
    for (const key of ["commissions_excluded_count", "receivables_excluded_count", "payables_excluded_count"]) {
      expect(route).toContain(key);
    }
  });

  it("M1/M2/M3/M5 — el RPC de severidad media corrige vencidas, efectivo, orden y caja", () => {
    const migration = read("supabase/migrations/0027_dashboard_exec_audit_media.sql");
    // M1: vencidas por due_date real, no por el flag status.
    expect(migration).toContain("r.due_date < (now() at time zone p_timezone)::date");
    expect(migration).toContain("count(*) filter (where is_overdue) as overdue_count");
    // M2: desglose de efectivo por divisa.
    expect(migration).toContain("cash_currency_rows as");
    expect(migration).toContain("'cash_by_currency'");
    // M3: próximas salidas en orden cronológico.
    expect(migration).toContain("order by departure_at asc");
    // M5: la caja acota la recaudación al usuario cajero.
    expect(migration).toContain("p_cash_user_id is null or p.user_id = p_cash_user_id");
  });

  it("M2 — la API y la UI exponen el efectivo por divisa", () => {
    expect(read("src/app/api/dashboard/route.ts")).toContain("cash_by_currency: permissions.canViewCash");
    const page = read("src/app/dashboard/_components/panel-empresa.tsx");
    expect(page).toContain("function cashHint");
    expect(page).toContain("cash_by_currency");
  });

  it("M4 — los indicadores y la gráfica son accesibles sin ratón", () => {
    // La definición del KPI llega a lectores de pantalla, no solo por title del ratón.
    expect(read("src/components/tf/kpi-card.tsx")).toContain('<span className="sr-only">{definition}</span>');
    // La gráfica de área ofrece una tabla equivalente para lectores de pantalla.
    const charts = read("src/components/tf/charts.tsx");
    expect(charts).toContain('<table className="sr-only">');
    expect(charts).toContain("<caption>Evolución de ventas por fecha</caption>");
  });

  it("Tareas — la vista permite crear tareas", () => {
    const page = read("src/app/dashboard/inicio/tareas/page.tsx");
    expect(page).toContain("CreateTaskDialog");
    const dialog = read("src/app/dashboard/inicio/tareas/create-task-dialog.tsx");
    expect(dialog).toContain('api.post("/api/erp/task"');
    // Por defecto se asigna a uno mismo, para que la tarea aparezca en esta vista.
    expect(dialog).toContain("assigned_to: assignedTo || currentUserId");
    expect(dialog).toContain('status: "todo"');
  });

  it("Notificaciones — buzón personal con marcar leídas y alcance por usuario", () => {
    const page = read("src/app/dashboard/inicio/notificaciones/page.tsx");
    expect(page).not.toContain("SimpleResource");
    expect(page).toContain('title="Notificaciones"');
    expect(page).toContain("Marcar todas como leídas");
    expect(page).toContain("/api/notifications");
    // La API acota a las notificaciones propias más los avisos de empresa que
    // le tocan por rol, con la MISMA función que el contador de la campana.
    const route = read("src/app/api/notifications/route.ts");
    expect(route).toMatch(/inboxFilter\(ctx\.userId, ctx\.role\)/);
    expect(route).toContain("mark_all_read");
    // Y no rearma el alcance por su cuenta: dos definiciones del buzón acaban
    // en un contador que promete avisos que la bandeja no enseña.
    expect(route).not.toMatch(/_or: \[\{ user_id/);
    // La ruta de marcado verifica pertenencia antes de escribir.
    const readRoute = read("src/app/api/notifications/[id]/read/route.ts");
    expect(readRoute).toContain("Esta notificación no es tuya");
    // El sidebar cuenta las no leídas con ese mismo alcance.
    expect(read("src/lib/nav.ts")).toContain('badgeKey: "notifications"');
    const layout = read("src/app/dashboard/layout.tsx");
    expect(layout).toMatch(/inboxFilter\(userId, ctx\.role\)/);
    expect(layout).not.toMatch(/_or: \[\{ user_id/);
  });

  it("POS — cobro con cambio en efectivo, total exacto y guardas de caja", () => {
    const page = read("src/app/dashboard/pos/page.tsx");
    // El efectivo se bloquea sin caja abierta (evita un cobro que el servidor rechaza).
    expect(page).toContain('disabled={o.value === "cash" && !canPayCash}');
    expect(page).toContain('payMethod === "cash" && !ctx?.cash_session');
    // Cálculo del cambio y del saldo pendiente.
    expect(page).toContain("cashChange");
    expect(page).toContain("pendingAfter");
    // Atajo de total exacto y vaciar la venta.
    expect(page).toContain("Total exacto");
    expect(page).toContain("Vaciar");
  });

  it("Reservas — exportación CSV, cobro con cambio y KPIs honestos por página", () => {
    const page = read("src/app/dashboard/reservas/page.tsx");
    // Exportación de las reservas filtradas (hasta 500) a CSV.
    expect(page).toContain("const exportCsv");
    expect(page).toContain('params.set("bulk", "true")');
    expect(page).toContain("text/csv");
    // Cobro de saldo con cambio en efectivo, saldo exacto y aviso de sobrepago.
    expect(page).toContain("payChange");
    expect(page).toContain("Saldo exacto");
    expect(page).toContain("overpay");
    // Los KPIs de importe se declaran por página (no como total filtrado).
    expect(page).toContain("en esta página");
  });

  it("Salidas — drill-down a reservas, filtro por ocupación y ventana de venta", () => {
    const page = read("src/app/dashboard/salidas/page.tsx");
    // Cada salida enlaza a sus reservas (la pantalla de reservas ya filtra por salida).
    expect(page).toContain("/dashboard/reservas?departure=${d._id}");
    // Filtro de ocupación que hace accionables los KPIs.
    expect(page).toContain("OCCUPANCY_FILTERS");
    expect(page).toContain("const visibleRows");
    // Ventana de venta derivada (nunca persistida) y exportación.
    expect(page).toContain("function TimingPill");
    expect(page).toContain("cutoffPassed");
    expect(page).toContain("const exportCsv");
    // El estado de la salida lo deriva el servidor: la pantalla no lo edita.
    expect(page).not.toContain('filter.status": "full"');
    expect(page).not.toMatch(/api\.(put|post)[^\n]*erp\/departure/);
  });

  it("Tickets — vigencia derivada de la fecha, consumo y exportación", () => {
    const page = read("src/app/dashboard/ventas/tickets/page.tsx");
    expect(page).not.toContain("SimpleResource");
    expect(page).toContain('title="Tickets de acceso"');
    // La vigencia real manda sobre el `status` almacenado (puede quedar obsoleto).
    expect(page).toContain("function ValidityPill");
    expect(page).toContain("const expired");
    expect(page).toContain("const usable");
    // Consumo de entradas y exportación de lo filtrado.
    expect(page).toContain("function UsageBar");
    expect(page).toContain("const exportCsv");
    // La vista comercial es de solo lectura: emitir/editar vive en Parque · Accesos.
    expect(page).not.toMatch(/api\.(post|put|delete)\(/);
  });

  it("todo recurso escribible se puede crear desde alguna pantalla", () => {
    /**
     * Un recurso con `writable` pero sin formulario es un módulo muerto: la
     * tabla se pinta, la API acepta escrituras y la aplicación no ofrece ninguna
     * forma de dar de alta el primer registro. Pasaba en 37 de los 72 recursos —
     * categorías del catálogo, tasas de cambio, cajas, turnos, cotizaciones —
     * porque `SimpleResource` nació como vista de solo lectura provisional y el
     * "provisional" se quedó.
     *
     * Lo que sí debe seguir sin alta manual es lo que genera otro flujo: un
     * voucher lo emite la reserva, una comisión el motor de comisiones, un
     * `stock_level` sale de los movimientos. Van aquí con su motivo, para que
     * añadir un recurso obligue a decidir a cuál de los dos grupos pertenece.
     */
    const FLOW_CREATED: Record<string, string> = {
      approval_request: "la crea el flujo de aprobaciones",
      commission: "la genera el motor de comisiones al vender",
      notification: "las emite el sistema",
      order: "nace en el punto de venta o en booking-service",
      participant: "se crea con su reserva",
      payable: "la genera el cierre de liquidaciones",
      pickup: "lo arma el despacho de operaciones",
      receivable: "la genera la venta a crédito",
      settlement: "la genera el proceso de liquidación",
      stock_level: "es el saldo derivado de los movimientos de inventario",
      voucher: "lo emite la reserva al confirmarse",
    };

    const resources = read("src/lib/resources.ts");
    const writable = new Set<string>();
    for (const block of resources.matchAll(/^ {2}(\w+):\s*\{\n([\s\S]*?)^ {2}\},/gm)) {
      const list = /writable:\s*\[([^\]]*)\]/.exec(block[2]);
      if (list && /"\w+"/.test(list[1])) writable.add(block[1]);
    }
    expect(writable.size, "no se pudo leer resources.ts").toBeGreaterThan(50);

    // Pantallas que ofrecen un formulario, y llamadas de alta a cualquier ruta.
    const creatable = new Set<string>();
    const DEDICATED: Record<string, string> = {
      gift_card: "/api/gift-cards", access_ticket: "/api/tickets",
      booking: "/api/bookings", payment: "/api/payments",
      cash_session: "/api/cash", departure: "/api/departures", task: "/api/tasks",
      quote: "/api/quotes", invoice: "/api/invoices",
      // Se apunta desde el punto de venta, en el instante en que la venta no
      // cabe: es el único momento en que el cliente está delante.
      waitlist_entry: "/api/waitlist",
    };
    for (const file of walk(path.join(ROOT, "src/app"))) {
      const src = readFileSync(file, "utf8");
      const resource = /resource="(\w+)"/.exec(src)?.[1];
      // Tolerante a un comentario entre el corchete y el primer campo: el
      // formulario se reconoce por tener campos, no por cómo esté formateado.
      const hasForm = /fields=\{\[[\s\S]{0,600}?\{\s*name:/.test(src) && !/canWrite=\{false\}/.test(src);
      if (resource && hasForm) creatable.add(resource);
      for (const m of src.matchAll(/api\.post[^(]*\(\s*[`"']\/api\/erp\/(\w+)/g)) creatable.add(m[1]);
      for (const [name, route] of Object.entries(DEDICATED)) {
        if (src.includes(`api.post`) && src.includes(route)) creatable.add(name);
      }
    }

    const orphans = [...writable].filter((r) => !creatable.has(r) && !(r in FLOW_CREATED)).sort();
    expect(orphans, "recursos escribibles sin ninguna forma de crearlos").toEqual([]);

    // Y al revés: si un recurso de la lista gana su formulario, sobra la excusa.
    const stale = Object.keys(FLOW_CREATED).filter((r) => creatable.has(r)).sort();
    expect(stale, "estos ya se crean desde una pantalla: quítalos de FLOW_CREATED").toEqual([]);
  });

  it("Operación — la salida tiene manifiesto, y sale del dominio", () => {
    /**
     * El despacho decía cuántos pax llevaba cada salida; quiénes eran, dónde se
     * les recoge y qué necesitan no estaba en ninguna pantalla, aunque los datos
     * llevaban ahí desde la primera migración repartidos en cinco tablas. Sin
     * esa hoja la operación se lleva en una hoja de cálculo aparte, y lo que se
     * cobra a bordo no vuelve nunca al sistema.
     */
    const page = read("src/app/dashboard/salidas/[id]/manifiesto/page.tsx");
    const route = read("src/app/api/departures/[id]/manifest/route.ts");
    // El armado vive en el servicio, que comparten la pantalla y el PDF.
    const service = read("src/lib/manifest-service.ts");

    // El orden es el de la ruta, no el de la venta, y lo decide el dominio.
    expect(service).toContain("sortByRoute");
    expect(service).toContain("pickupStops");
    expect(service).toContain("manifestAlerts");
    // Una reserva cancelada no viaja: contarla manda al guía a buscar a alguien
    // que no existe y da la salida por llena.
    expect(service).toContain("DEAD_BOOKING_STATUSES");
    /**
     * Es una lista de clientes: un socio no ve las reservas de la competencia.
     *
     * Se comprueba `esDeSocio` y no el nombre del rol: un empleado de un tour
     * center dado de alta como `seller` TIENE identificador de socio y no ese
     * rol, así que por el nombre se habría llevado el manifiesto entero.
     */
    expect(route).toMatch(/esDeSocio\(ctx\)/);

    // Y está hecha para imprimirse.
    expect(page).toContain("window.print()");
    expect(page).toContain("no-print");
    expect(page).toContain("print-block");
    expect(read("src/app/globals.css")).toContain("@media print");

    // Se llega desde donde se planifica el día y desde el calendario de salidas.
    expect(read("src/app/dashboard/operaciones/despacho/page.tsx")).toContain("/manifiesto");
    expect(read("src/app/dashboard/salidas/page.tsx")).toContain("/manifiesto");
  });

  it("Operación — cerrar una salida no es editar un campo", () => {
    const resources = read("src/lib/resources.ts");
    const departure = /^ {2}departure: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    const writable = /writable:\s*\[([\s\S]*?)\]/.exec(departure)![1];

    // `actual_pax` es el número del que salen la ocupación real y la comisión
    // del guía: se cuenta desde los check-in, no se teclea. Y `status` lleva
    // fuera del CRUD desde AUD-B02 porque editarlo reabría una salida llena.
    for (const field of ['"status"', '"actual_pax"', '"no_show_pax"', '"closed_at"', '"booked_pax"']) {
      expect(writable, `departure.writable no debe incluir ${field}`).not.toContain(field);
    }

    const close = read("src/app/api/departures/[id]/close/route.ts");
    expect(close).toContain("closeBlocker");
    expect(close).toContain("closeTotals");
    // Un no-show se vendió y no viajó: el cierre los separa.
    expect(close).toContain("no_show_pax: totals.no_show_pax");
    // Saltarse una comprobación es excepción de gestión, con motivo y auditada.
    expect(close).toMatch(/requireAtLeast\(ctx, "manager"\)/);
    expect(close).toContain("necesita un motivo");
  });

  it("Comunicaciones — nada se manda por fuera de la bandeja de salida", () => {
    /**
     * La plataforma no mandaba nada: las confirmaciones y los recordatorios
     * salían del WhatsApp personal de quien atendiera, y "¿se le avisó?" no
     * tenía respuesta. Ahora todo pasa por la bandeja, que es el registro.
     */
    const files = walk(path.join(ROOT, "src")).filter((f) => !f.includes("messaging/providers"));
    const direct = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /api\.resend\.com|graph\.facebook\.com/.test(src);
    });
    expect(direct.map((f) => path.relative(ROOT, f)),
      "solo providers.ts habla con el proveedor").toEqual([]);

    // La bandeja es un libro: se lee desde el CRUD, se escribe por su acción.
    const resources = read("src/lib/resources.ts");
    const message = /^ {2}message: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    expect(/writable:\s*\[([^\]]*)\]/.exec(message)![1].trim()).toBe("");

    // Y las credenciales no se guardan por inquilino: la pantalla de
    // integraciones manda esas filas al navegador.
    const providers = read("src/lib/messaging/providers.ts");
    expect(providers).toContain("process.env");
    const outbox = read("src/lib/messaging/outbox.ts");
    expect(outbox).not.toMatch(/api_key|apiKey|token/i);
  });

  it("Comunicaciones — un aviso no puede tumbar la operación que lo provoca", () => {
    /**
     * Que el proveedor de correo esté caído no puede revertir una venta ya
     * cobrada ni hacer esperar al cajero con el cliente delante. Cada enganche
     * se traga su error y lo deja en la bandeja.
     */
    for (const file of [
      "src/lib/booking-service.ts",
      "src/app/api/payments/route.ts",
      // La cancelación dejó de vivir en su ruta: ahora hay más de un origen
      // (mostrador y conector OCTO) y todos pasan por el mismo servicio.
      "src/lib/booking-cancel-service.ts",
      "src/app/api/quotes/[id]/send/route.ts",
    ]) {
      const src = read(file);
      // La LLAMADA, no el import: `await notify…(`.
      const call = /await\s+(notifyBookingCreated|notifyPaymentReceived|notifyBookingCancelled|notifyQuoteSent)\s*\(/.exec(src);
      expect(call, `${file} debe encolar su aviso`).toBeTruthy();
      const at = src.indexOf(call![0]);
      const around = src.slice(Math.max(0, at - 400), at + 800);
      expect(around, `${file} no protege el encolado`).toMatch(/try\s*\{[\s\S]*catch/);
    }

    // El despacho de la cola es un trabajo programado y con credencial.
    const cron = read("src/app/api/cron/dispatch-messages/route.ts");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toMatch(/Bearer \$\{secret\}/);
    expect(read("vercel.json")).toContain("/api/cron/dispatch-messages");

    // Y lee con el cliente de servicio: con RLS activo, las ayudas de inquilino
    // resuelven el cliente desde las cookies de la petición, y un cron no las
    // tiene. Escrito contra ellas no se rompería — leería cero mensajes y diría
    // que la cola está al día, que es el peor fallo posible aquí.
    expect(cron).toContain("supabaseService()");
    expect(cron).toContain("serviceStore()");
    // El almacén vive aparte desde 0039, porque lo comparten dos trabajos: el
    // despacho de la cola y la cobranza diaria.
    const store = read("src/lib/messaging/service-store.ts");
    expect(store).toContain("supabaseService()");
    expect(store).toMatch(/eq\("organization_id", companyId\)/);

    // El recordatorio de la víspera también se barre: si solo se encolara al
    // vender, la cartera que ya compró antes de que hubiera comunicaciones se
    // quedaría sin avisar, que es justo el grupo que ya pagó.
    expect(cron).toContain("sweepReminders");
    expect(cron).toContain("enqueuePreTourReminder");

    // El insert en crudo tiene que aplicar el MISMO mapa de alias que las
    // ayudas de inquilino: los payloads del módulo dicen `customer`, la columna
    // se llama `customer_id`, y sin traducir no se encolaba ni un recordatorio.
    expect(store).toContain("aliasesFor(\"message\")");
  });

  it("Comunicaciones — lo que se encola en una petición se entrega al terminarla", () => {
    /**
     * El cron pasó a ser diario: el plan Hobby de Vercel no admite crons
     * sub-diarios y con uno cada cuarto de hora el despliegue ENTERO fallaba.
     * Dejar la entrega
     * solo en manos del barrido convertía la confirmación de una reserva hecha a
     * las 9 de la mañana en un correo que sale a la mañana siguiente.
     *
     * Toda ruta que encola tiene que drenar al terminar. Si aparece una nueva que
     * encola y no drena, su aviso espera al barrido y nadie se enteraría: el
     * fallo es silencio, y por eso se comprueba aquí.
     */
    const NOTIFIERS = /notify(BookingCreated|PaymentReceived|QuoteSent|BookingCancelled)\s*\(/;
    const enqueuing = walk(path.join(ROOT, "src/app/api"))
      .filter((file) => NOTIFIERS.test(readFileSync(file, "utf8")) || /createOrderWithBookings\s*\(/.test(readFileSync(file, "utf8")))
      // Los crons no tienen respuesta que esperar: ellos SON el barrido.
      .filter((file) => !file.includes(`${path.sep}cron${path.sep}`));

    expect(enqueuing.length, "no se encontró ninguna ruta que encole avisos").toBeGreaterThan(0);
    // La LLAMADA, no el import: comprobar que el nombre aparece en el archivo
    // daría por bueno un `import` sin usar, que es exactamente el descuido que
    // esta guarda existe para cazar.
    const CALL = /^\s*flushOutboxAfterResponse\s*\(/m;
    const silent = enqueuing.filter((file) => !CALL.test(readFileSync(file, "utf8")));
    expect(
      silent.map((f) => path.relative(ROOT, f)),
      "estas rutas encolan un aviso y no lo entregan hasta el barrido diario"
    ).toEqual([]);

    // Y se entrega DESPUÉS de la respuesta, nunca dentro: meter la latencia del
    // proveedor de correo en medio de una venta es lo que la separación entre
    // encolar y entregar existía para evitar.
    const flush = read("src/lib/messaging/flush.ts");
    expect(flush).toMatch(/import \{ after \} from "next\/server"/);
    expect(flush).toMatch(/after\(\(\) => drainOutbox\(/);
    // Con el cliente de servicio: después de la respuesta no hay garantía de que
    // la sesión siga resolviéndose desde las cookies, y una cola que lee cero
    // mensajes diciendo que está vacía es el peor fallo posible.
    expect(flush).toContain("serviceStore()");
    // Y nada de lo que pase aquí puede escalar: la operación ya terminó.
    expect(flush).toMatch(/catch \(err\)[\s\S]{0,200}console\.error/);
  });

  it("Comunicaciones — un aviso se manda una vez", () => {
    // Cada pasada del cron volviendo a escribirle al cliente es la forma más
    // rápida de que marque la dirección como spam.
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0034_messaging_outbox.sql"), "utf8");
    expect(sql).toContain("create unique index if not exists message_dedupe_idx");
    const events = read("src/lib/messaging/events.ts");
    expect(events).toContain("dedupeKey: `${key}:${channel}:${base.dedupeSeed}`");

    // Y el envío manual NO lleva dedupe: reenviar a petición del cliente es
    // legítimo y no puede quedar bloqueado por el aviso automático.
    expect(read("src/app/api/messages/route.ts")).toContain("dedupeKey: null");

    // Un canal que el cliente nunca dio no es un fallo de entrega: registrarlo
    // como tal llenaría la bandeja de fallos permanentes, uno por cada cliente
    // que solo dio correo, hasta tapar los fallos de verdad.
    expect(events).toContain("const reachable = CHANNELS.filter");
  });

  it("Documentos — los tres papeles existen y se descargan", () => {
    /**
     * El sistema no producía ni un documento: el voucher viajaba como un código
     * de texto dentro de un correo, la cotización había que copiarla a mano a
     * otro documento, y el manifiesto solo existía como pantalla —que exige
     * sesión, justo lo que el guía no tiene a las 6 de la mañana.
     */
    for (const route of [
      "src/app/api/bookings/[id]/voucher/route.ts",
      "src/app/api/quotes/[id]/pdf/route.ts",
      "src/app/api/departures/[id]/manifest/pdf/route.ts",
    ]) {
      expect(read(route), `${route} debe devolver un PDF`).toContain("pdfResponse");
    }

    // Y se llega a ellos desde donde se usa cada uno.
    expect(read("src/app/dashboard/reservas/page.tsx")).toContain("/voucher");
    expect(read("src/app/dashboard/ventas/cotizaciones/quote-drawer.tsx")).toContain("/pdf");
    expect(read("src/app/dashboard/salidas/[id]/manifiesto/page.tsx")).toContain("/manifest/pdf");

    // El voucher lleva QR: sin él el check-in vuelve a teclearse a mano.
    expect(read("src/lib/pdf/documents.ts")).toContain("QRCode.toBuffer");

    // Un documento con importes no puede quedarse cacheado entre usuarios.
    expect(read("src/lib/pdf/doc.ts")).toContain('"Cache-Control": "private, no-store"');

    // Las notas internas de una cotización —coste del proveedor, margen
    // negociable— no salen en el papel del cliente.
    const documents = read("src/lib/pdf/documents.ts");
    expect(documents).not.toContain("quote.internal_notes");
  });

  it("Documentos — el manifiesto de la pantalla y el del papel se arman igual", () => {
    // Con la consulta duplicada bastaba con que una olvidara excluir las
    // reservas canceladas para que papel y pantalla dieran cuentas distintas.
    for (const route of [
      "src/app/api/departures/[id]/manifest/route.ts",
      "src/app/api/departures/[id]/manifest/pdf/route.ts",
    ]) {
      expect(read(route)).toContain("loadManifest");
    }
    expect(read("src/lib/manifest-service.ts")).toContain("DEAD_BOOKING_STATUSES");
  });

  it("Documentos — el adjunto se compone al entregar, no al encolar", () => {
    /**
     * Entre que se encola la confirmación y sale el correo puede haberse
     * cobrado el saldo o cambiado la hora de recogida: un voucher con datos
     * viejos es peor que ninguno, porque el cliente se presenta a la hora que
     * dice el papel.
     */
    const outbox = read("src/lib/messaging/outbox.ts");
    expect(outbox).toContain("resolveAttachment");
    // La fila guarda QUÉ documento, no el documento: un PDF en base64 por fila
    // haría inmanejable la bandeja.
    expect(outbox).toContain("attachment_kind");
    expect(outbox).not.toMatch(/content:\s*base64/);

    // Y solo el correo lleva ficheros.
    expect(outbox).toContain('input.channel === "email" ? input.attachmentKind');

    // Un fallo del adjunto no puede perder el aviso: la hora de recogida sigue
    // sirviendo aunque el PDF no se haya podido generar.
    expect(read("src/lib/messaging/attachments.ts")).toMatch(/try\s*\{[\s\S]*catch[\s\S]*return null/);
  });

  it("Catálogo — los extras se venden con el tour, no como un producto suelto", () => {
    /**
     * Sin modelarlos, el vendedor tenía dos salidas y las dos malas: crear un
     * producto "Almuerzo langosta" que ensucia el catálogo y descuadra la
     * ocupación de las salidas —cada extra contaba como una reserva más—, o
     * cobrarlo por fuera, donde no aparece ni en la rentabilidad del tour ni en
     * el voucher que el cliente enseña al guía.
     */
    const service = read("src/lib/booking-service.ts");
    expect(service).toContain("priceExtras");
    // Un extra que el catálogo no reconoce se rechaza: cobrar de menos en
    // silencio es peor que fallar.
    expect(service).toContain("unknownSelections");

    // El impuesto cae también sobre los extras. Sumarlos después los dejaba
    // exentos, y en un grupo de 40 con almuerzo de 35 son 1.400 sin ITBIS.
    expect(service).toContain("const taxAmount = round2((netAmount * taxPct) / 100)");

    // El precio se congela con la reserva: si mañana sube el almuerzo, la de
    // ayer sigue valiendo lo que el cliente pagó.
    const resources = read("src/lib/resources.ts");
    const contracted = /^ {2}booking_extra: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    expect(/writable:\s*\[([^\]]*)\]/.exec(contracted)![1].trim()).toBe("");

    // Se ofrecen en el punto de venta y viajan en el voucher.
    expect(read("src/app/api/pos/context/route.ts")).toContain("product_extra");
    expect(read("src/app/dashboard/pos/page.tsx")).toContain("item.product.extras");
    expect(read("src/app/api/bookings/[id]/voucher/route.ts")).toContain("booking_extra");
  });

  it("Catálogo — el voucher dice lo que el producto promete", () => {
    // El contenido de la ficha existía desde 0030 y ningún documento lo usaba:
    // el cliente recibía un papel sin qué incluye, qué no, ni qué llevar.
    const route = read("src/app/api/bookings/[id]/voucher/route.ts");
    for (const field of ["inclusions", "exclusions", "recommendations", "restrictions", "instructions"]) {
      expect(route, `el voucher debe llevar ${field}`).toContain(field);
    }
    // Y el mismo contenido va en el adjunto del correo, no una versión pobre.
    const attachments = read("src/lib/messaging/attachments.ts");
    expect(attachments).toContain("inclusions");
    expect(attachments).toContain("recommendations");
  });

  it("Fiscal — el NCF no se teclea, lo entrega la base de forma atómica", () => {
    /**
     * La pantalla era un formulario donde el NCF, el subtotal, el impuesto y el
     * total se escribían a mano. Eso rompe de tres formas que la DGII ve: dos
     * cajas facturando a la vez escriben el mismo NCF; un número saltado hay que
     * justificarlo en el 606/607 meses después; y el impuesto tecleado no
     * coincide con el de la venta.
     */
    const resources = read("src/lib/resources.ts");
    const invoice = /^ {2}invoice: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    const writable = /writable:\s*\[([\s\S]*?)\]/.exec(invoice)![1];
    for (const field of ['"ncf"', '"ncf_type"', '"number"', '"series"', '"status"',
                         '"subtotal"', '"tax"', '"total"', '"voided_at"', '"order"']) {
      expect(writable, `invoice.writable no debe incluir ${field}`).not.toContain(field);
    }

    // `next_number` tampoco: moverlo a mano es cómo se repiten o se saltan.
    const sequence = /^ {2}ncf_sequence: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    expect(/writable:\s*\[([\s\S]*?)\]/.exec(sequence)![1]).not.toContain('"next_number"');

    // El número lo entrega la función de la base, no la aplicación: comprobar
    // el rango y reservar ocurren en la MISMA sentencia.
    const service = read("src/lib/invoice-service.ts");
    expect(service).toContain('sb.rpc("next_ncf"');
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0037_fiscal_invoicing.sql"), "utf8");
    expect(sql).toContain("update ncf_sequence");
    expect(sql).toMatch(/set next_number = next_number \+ 1/);
    // Y no entrega números de otro inquilino aunque le pasen su id.
    expect(sql).toContain("app.current_org_id() <> p_org");

    // Una sola secuencia viva por tipo: dos serían dos numeraciones paralelas.
    expect(sql).toContain("unique (organization_id, ncf_type)");

    // La factura tiene que cuadrar con la orden que la origina: la tasa sale de
    // la PROPIA reserva, no del perfil fiscal, que es otro número en cuanto el
    // perfil cambia de tasa o la reserva se vendió exenta.
    expect(service).toContain("taxAmount / net");
    expect(service).toMatch(/invoiceTotals\(draftLines as InvoiceLineInput\[\], false\)/);
  });

  it("Fiscal — una factura emitida se anula con nota de crédito, no se borra", () => {
    // El cliente ya la tiene y probablemente ya está en su declaración; borrarla
    // deja además un hueco en la secuencia que hay que justificar.
    const service = read("src/lib/invoice-service.ts");
    expect(service).toContain("creditNoteTypeFor");
    expect(service).toContain("credit_note_of");
    expect(service).toContain("necesita un motivo");
    // La nota de crédito copia el desglose: sin líneas no se puede demostrar QUÉ
    // se anuló, que es lo que se pregunta en una inspección.
    expect(service).toMatch(/for \(const line of lines\)[\s\S]{0,200}invoice_line/);

    // Anular es decisión de gestión, no del cajero que se equivocó.
    expect(read("src/app/api/invoices/[id]/void/route.ts")).toMatch(/requireAtLeast\(ctx, "manager"\)/);
  });

  it("Caja — el arqueo se cuenta por denominación, no se teclea el total", () => {
    /**
     * La versión anterior abría el diálogo con el efectivo esperado YA ESCRITO
     * en el campo del conteo. Así la caja siempre cuadraba: nadie contaba, se
     * confirmaba un número. El conteo tiene que salir de las piezas.
     */
    const dialog = read("src/app/dashboard/caja/arqueo-dialog.tsx");
    expect(dialog).toContain("denominationsFor");
    expect(dialog).toContain("countTotal");
    // Ni el campo del conteo ni su estado inicial pueden partir de lo esperado.
    expect(dialog).not.toMatch(/setCounts\([^)]*expected/);
    expect(dialog).not.toMatch(/value=\{[^}]*expected[^}]*\}\s*\n?\s*onChange=\{\(e\) => setQuantity/);
    // Y se cuenta a ciegas: ver el objetivo mientras se cuenta es no contar.
    expect(dialog).toContain("blind");

    // El servidor no acepta un esperado ni una diferencia del cliente: los dos
    // salen de los movimientos.
    const close = read("src/app/api/cash/sessions/[id]/close/route.ts");
    expect(close).not.toMatch(/body\.(expected|difference)\b/);
    expect(close).toContain("recalcCashSession");
    expect(close).toContain("invalidDenominations");
    // Contar solo una de las monedas del turno deja la otra sin arquear.
    expect(close).toMatch(/Falta contar el efectivo/);
  });

  it("Caja — un descuadre lo revisa otra persona, y cuesta dinero", () => {
    const review = read("src/app/api/cash/sessions/[id]/review/route.ts");
    // Rango de gestión, y nunca el mismo que cerró: sin las dos cosas,
    // "supervisado" solo significa que el cajero hizo dos clics.
    expect(review).toMatch(/requireAtLeast\(ctx, "manager"\)/);
    expect(review).toMatch(/closedBy[\s\S]{0,200}ctx\.userId/);
    expect(review).toContain("postCashDifference");
    expect(review).toContain("writeAudit");

    // El faltante es una pérdida y el sobrante un ingreso: tienen cuenta.
    const ledger = read("src/lib/ledger.ts");
    expect(ledger).toContain("Faltantes de caja");
    expect(ledger).toContain("Sobrantes de caja");
    expect(ledger).toContain("cash_close");
  });

  it("Caja — el arqueo de la pantalla y el del acta se arman igual", () => {
    // Un papel que se archiva con el efectivo y no dice lo mismo que el sistema
    // no prueba nada tres meses después.
    for (const route of [
      "src/app/api/cash/sessions/[id]/arqueo/route.ts",
      "src/app/api/cash/sessions/[id]/arqueo/pdf/route.ts",
      "src/app/api/cash/sessions/[id]/close/route.ts",
    ]) {
      expect(read(route)).toContain("loadCashClose");
    }
    expect(read("src/lib/pdf/documents.ts")).toContain("buildCashClosePdf");
  });

  it("Caja — el efectivo no se suma entre monedas", () => {
    /**
     * `expected_cash` era un escalar y el recálculo metía en él importes de
     * monedas distintas: 100 USD y 100 DOP daban 200 de nada. La pantalla
     * hacía lo mismo con los KPI, pintando la suma con la moneda de la
     * primera caja de la lista.
     */
    const domain = read("src/lib/cash-close.ts");
    expect(domain).toContain("CurrencySummary");
    expect(domain).toMatch(/expected_by_currency|byCurrencyMap/);

    const recalc = read("src/lib/cash.ts");
    expect(recalc).toContain("summarizeCash");
    expect(recalc).toContain("expected_by_currency");

    const screen = read("src/app/dashboard/caja/page.tsx");
    expect(screen).toContain("totalByCurrency");
    // El KPI ya no recibe la moneda de `sessions[0]`.
    expect(screen).not.toMatch(/sessions\[0\]\?\.currency/);
  });

  it("Cobros — lo pactado en la cotización llega a la venta", () => {
    /**
     * La cotización negociaba el anticipo desde 0032 y al convertirla esas
     * condiciones se PERDÍAN: la venta nacía con la política genérica del
     * producto y el cliente recibía un vencimiento que nadie había acordado.
     */
    const convert = read("src/app/api/quotes/[id]/convert/route.ts");
    expect(convert).toMatch(/terms:\s*\{[\s\S]{0,400}deposit_type/);
    expect(convert).toContain("balance_due_date");

    const service = read("src/lib/booking-service.ts");
    expect(service).toMatch(/deposit_type: input\.terms\?\.deposit_type/);
    // Y el calendario se crea con la venta, fuera de la saga: un plan que no se
    // pudo escribir se reconstruye —es derivado—, una venta cobrada no.
    expect(service).toContain("ensureSchedule");
    const at = service.indexOf("await ensureSchedule(");
    expect(service.slice(Math.max(0, at - 300), at + 200)).toMatch(/try\s*\{[\s\S]*catch/);

    // La ruta HTTP no acepta condiciones del navegador: permitirían regalarse
    // un anticipo de cero y un saldo a un año.
    expect(read("src/app/api/orders/route.ts")).toContain("delete body.terms");
  });

  it("Cobros — lo imputado se deriva del total cobrado, no se acumula", () => {
    /**
     * Ir sumando pago a pago obliga a acertar en todos los casos —un reembolso
     * parcial, un plan que se rehace a mitad— y basta fallar en uno para que el
     * plan y el saldo de la orden discrepen para siempre.
     */
    const service = read("src/lib/schedule-service.ts");
    expect(service).toContain("refreshAllocation");
    expect(service).toMatch(/paid_total/);
    // Se parte de cero en cada recálculo: repartir sobre lo ya imputado sumaría
    // dos veces el mismo dinero.
    expect(service).toMatch(/paid_amount: 0/);
    // Y rehacer un plan no borra un cobro: las cuotas viejas se anulan.
    expect(service).toMatch(/status: "cancelled"/);

    // Cada cambio de dinero de la orden lo arrastra.
    const booking = read("src/lib/booking-service.ts");
    const sync = booking.slice(booking.indexOf("export async function syncOrderTotals"));
    expect(sync).toContain("refreshAllocation");

    // Las cuotas suman exactamente el total, también al fijarlas a mano.
    expect(service).toMatch(/Tienen que cuadrar/);
  });

  it("Cobros — el recordatorio del saldo por fin se dispara", () => {
    /**
     * La plantilla `balance_due` se creó con el módulo de comunicaciones, se
     * documentó y se sembró en cada empresa… y NADA la disparaba. El sistema
     * prometía recordarle al cliente su saldo y no recordaba ninguno.
     */
    const events = read("src/lib/messaging/events.ts");
    expect(events).toContain("export async function notifyBalanceDue");
    expect(events).toMatch(/"balance_due"/);

    const cron = read("src/app/api/cron/collections/route.ts");
    expect(cron).toContain("notifyBalanceDue");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toMatch(/Bearer \$\{secret\}/);
    expect(read("vercel.json")).toContain("/api/cron/collections");
    // Cliente de servicio con filtro explícito: bajo RLS leería cero cuotas y
    // diría que no hay nada que cobrar.
    expect(cron).toContain("supabaseService()");
    expect(cron).toMatch(/eq\("organization_id", row\.organization_id\)/);
    // Y no le escribe todos los días hasta que pague.
    expect(cron).toContain("reminded_at");
    expect(cron).toMatch(/REMIND_COOLDOWN_DAYS/);
  });

  it("Cobros — la antigüedad y el límite de crédito dejan de ser decorativos", () => {
    // `aging_bucket` se escribía 'current' al crear y no se tocaba más, y era
    // editable a mano: el tramo era lo último que alguien tecleó.
    const resources = read("src/lib/resources.ts");
    const receivable = /^ {2}receivable: \{\n([\s\S]*?)^ {2}\},/m.exec(resources)?.[1] ?? "";
    expect(receivable).not.toMatch(/"aging_bucket"/);
    expect(receivable).not.toMatch(/writable: \[[^\]]*"status"/);
    expect(read("src/app/api/cron/collections/route.ts")).toContain("agingBucketFor");

    // `credit_limit` llevaba desde 0002 sin que nada lo mirara: se vendía a
    // crédito sin techo.
    const service = read("src/lib/booking-service.ts");
    expect(service).toContain("creditCheck");
    const at = service.indexOf("creditCheck(creditTerms");
    expect(at).toBeGreaterThan(0);
    // La comprobación va ANTES de escribir la orden.
    expect(at).toBeLessThan(service.indexOf('tenantCreate<Order>(companyId, "order"'));
    // Y saltárselo es decisión de gestión, nunca del portal del socio.
    const route = read("src/app/api/orders/route.ts");
    expect(route).toMatch(/allow_over_credit[\s\S]{0,200}requireAtLeast\(ctx, "manager"\)/);
    expect(route).toMatch(/esDeSocio\(ctx\)\)\s*delete body\.allow_over_credit/);
  });

  it("Proveedores — el costo sabe de quién es, y sale del mismo cálculo que el margen", () => {
    /**
     * `product_cost` guardaba el costo POR PROVEEDOR y `resolveCost` los sumaba
     * todos tirando el proveedor: el costo servía para el margen y para nada
     * más —con él no se podía pagar a nadie.
     */
    const pricing = read("src/lib/pricing.ts");
    // El total del margen es la SUMA de las líneas por proveedor, no un cálculo
    // aparte: con dos implementaciones, arreglar una desvía la otra.
    expect(pricing).toContain("costLines");
    expect(pricing).toContain("costTotal");
    expect(pricing).toContain("loadCostTariffs");
    // Y las dos cargas usan la misma consulta de tarifas.
    const resolve = pricing.slice(pricing.indexOf("export async function resolveCost"));
    expect(resolve).toContain("loadCostTariffs");

    const service = read("src/lib/supplier-settlement-service.ts");
    expect(service).toContain("loadCostTariffs");

    // El devengo se congela al vender, dentro de la venta: calcularlo al
    // liquidar aplicaría a lo operado el lunes una tarifa que cambió el
    // miércoles.
    const booking = read("src/lib/booking-service.ts");
    expect(booking).toMatch(/await accrueBookingCosts\(/);
    const at = booking.indexOf("await accrueBookingCosts(");
    expect(at).toBeLessThan(booking.indexOf("bookings.push(booking)"));
  });

  it("Proveedores — una reserva cancelada no le debe nada a nadie", () => {
    // Dejar el devengo vivo se lo pagaría al transportista en la liquidación
    // del viernes por un viaje que no salió.
    expect(read("src/lib/booking-cancel-service.ts")).toContain("cancelBookingCosts");
    expect(read("src/lib/booking-service.ts")).toContain("cancelBookingCosts");
    // Y un servicio ya pagado no se toca: ese dinero salió.
    const service = read("src/lib/supplier-settlement-service.ts");
    expect(service).toMatch(/\["settled", "paid"\]\.includes/);
  });

  it("Proveedores — no se paga sin comprobante, ni una liquidación en disputa", () => {
    /**
     * El gasto se sostiene ante la DGII con la factura del proveedor, y pagar
     * una que no cuadra con lo operado es regalar dinero con un papel de por
     * medio.
     */
    const domain = read("src/lib/supplier-settlement.ts");
    expect(domain).toContain("not_confirmed");
    expect(domain).toContain("disputed");

    const pay = read("src/app/api/settlements/[id]/pay/route.ts");
    expect(pay).toContain("payBlocker");
    // El proveedor cobra el NETO tras retenciones, no el bruto.
    expect(pay).toMatch(/net_total/);
    // Saltarse el comprobante es decisión de administración y queda auditada.
    expect(pay).toMatch(/skip_invoice_check[\s\S]{0,200}requireAtLeast\(ctx, "admin"\)/);
    expect(pay).toMatch(/severity: body\.skip_invoice_check \? "warning"/);

    // El abono parcial existe: 'partially_paid' estaba en el check desde 0006 y
    // solo se escribía 'paid'.
    expect(domain).toContain("stateAfterPayment");
    expect(pay).toContain("stateAfterPayment");
  });

  it("Proveedores — las retenciones se calculan sobre la factura, no sobre el neto", () => {
    const domain = read("src/lib/supplier-settlement.ts");
    // El ITBIS se SEPARA del bruto; aplicar las dos retenciones sobre el bruto
    // retendría de más.
    expect(domain).toMatch(/gross \/ \(1 \+ taxRate \/ 100\)/);
    expect(domain).toContain("DEFAULT_RETENTIONS");
    // Los porcentajes del proveedor mandan sobre los del régimen.
    expect(domain).toMatch(/retention_isr_pct == null \? defaults\.isr/);

    // Y el estado de cuenta que ve el proveedor sale de la misma carga que el
    // PDF y que la conciliación.
    for (const route of [
      "src/app/api/settlements/[id]/statement/route.ts",
      "src/app/api/settlements/[id]/statement/pdf/route.ts",
      "src/app/api/settlements/[id]/confirm/route.ts",
    ]) {
      expect(read(route)).toContain("loadSupplierStatement");
    }
    expect(read("src/lib/pdf/documents.ts")).toContain("buildSupplierStatementPdf");
  });

  it("Proveedores — una liquidación no mezcla monedas ni reclama dos veces", () => {
    const service = read("src/lib/supplier-settlement-service.ts");
    // Pagarle en un solo importe lo que se le debe en pesos y en dólares es
    // inventarse una tasa.
    expect(service).toMatch(/Liquida cada moneda por separado/);
    /**
     * ──────────────────────────────────────────────────────────────────────
     * LA CONDICIÓN VIAJA DENTRO DE LA ESCRITURA
     *
     * Esta guarda exigía `CLAIMABLE.has(fresh.status)`: o sea, releer el
     * devengo y decidir en la aplicación. Eso ESTRECHA la ventana y no la
     * cierra — entre la lectura y la escritura cabe otra liquidación, y se
     * comprobó que cabía: la segunda pisaba el enlace de la primera y contaba
     * el importe igual, así que al transportista se le pagaba dos veces.
     *
     * La guarda fijaba la implementación en vez de la regla, y al sustituirla
     * por una más fuerte saltó. Ahora afirma la regla: reclamar es un `update`
     * con la condición dentro (`in("status", …)`), y lo que se cuenta es lo que
     * la base dice que cambió.
     */
    expect(service, "reclamar tiene que ser una escritura condicional")
      .toMatch(/\.update\(\{ status: "settled"[\s\S]{0,300}?\.in\("status", \[\.\.\.CLAIMABLE\]\)/);
    // Y no se cuenta lo que se leyó antes, sino la fila devuelta.
    expect(service).toMatch(/const mio = await claimCost\(/);
    expect(service).toMatch(/if \(!mio\) continue;/);
    // Y una liquidación que no reclamó nada se anula en vez de quedar en cero.
    expect(service).toMatch(/status: "void"/);
  });

  it("los registros derivados no se borran desde el CRUD genérico", () => {
    /**
     * Un recurso con `writable` vacío es un libro: el registro de auditoría, los
     * asientos contables, los movimientos de caja y de gift card, las líneas de
     * una cotización. La ruta genérica no los dejaba escribir pero SÍ borrar con
     * rango de gestión, y borrar la fila que explica un saldo lo descuadra sin
     * dejar rastro de por qué.
     */
    const route = read("src/app/api/erp/[resource]/[id]/route.ts");
    expect(route).toMatch(/if \(!def\.writable \|\| def\.writable\.length === 0\)/);
    // La guarda va ANTES de resolver el inquilino: es una decisión del recurso.
    const del = route.slice(route.indexOf("export async function DELETE"));
    expect(del.indexOf("def.writable.length === 0")).toBeLessThan(del.indexOf("tenantDelete"));

    // Y sigue habiendo libros que proteger: si esta lista se vacía, la guarda
    // dejó de cubrir nada y hay que revisar por qué.
    const resources = read("src/lib/resources.ts");
    const ledgers = [...resources.matchAll(/^ {2}(\w+): \{\n([\s\S]*?)^ {2}\},/gm)]
      .filter((m) => /writable:\s*\[\s*\]/.test(m[2]))
      .map((m) => m[1]);
    expect(ledgers).toEqual(expect.arrayContaining([
      "audit_log", "ledger_entry", "cash_movement", "cash_count", "gift_card_movement",
      "quote_line", "quote_option", "payment_schedule", "booking_cost",
    ]));
  });

  it("Gift cards — el saldo solo se mueve por sus acciones", () => {
    const page = read("src/app/dashboard/clientes/gift-cards/page.tsx");
    const drawer = read("src/app/dashboard/clientes/gift-cards/gift-card-drawer.tsx");
    const resources = read("src/lib/resources.ts");
    const service = read("src/lib/gift-card-service.ts");

    // El saldo de una gift card es dinero del cliente: como campo de formulario
    // cualquiera con permiso de escritura podía ponerle el número que quisiera.
    // Anclado al inicio de línea: `expandOne` menciona `gift_card_movement: {`
    // dentro del propio bloque y un regex laxo capturaba el bloque equivocado.
    const card = /^ {2}gift_card: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    const writable = /writable:\s*\[([^\]]*)\]/.exec(card)![1];
    for (const field of ['"balance"', '"initial_amount"', '"status"']) {
      expect(writable, `gift_card.writable no debe incluir ${field}`).not.toContain(field);
    }
    // Y los movimientos son el libro de la tarjeta: se leen, no se escriben.
    const movement = /^ {2}gift_card_movement: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    expect(/writable:\s*\[([^\]]*)\]/.exec(movement)![1].trim()).toBe("");

    // Un solo punto del código escribe un saldo de gift card: incluso la emisión
    // crea la tarjeta en cero y la funde con su movimiento.
    const writers = walk(path.join(ROOT, "src")).filter((file) =>
      /tenantUpdate\([^)]*"gift_card"/.test(readFileSync(file, "utf8"))
    );
    expect(writers.map((f) => path.relative(ROOT, f)))
      .toEqual(["src/lib/gift-card-service.ts"]);
    expect(service).toContain('tenantUpdate(ctx.companyId, "gift_card"');
    expect(page, "el alta pasa por la acción, no por el formulario genérico").toContain("canWrite={false}");
    expect(page).toContain('api.post<{ code: string }>("/api/gift-cards"');
    expect(drawer).toMatch(/\/api\/gift-cards\/\$\{card\._id\}\/\$\{action\}/);
    // La lista se recarga tras cada movimiento, o mostraría el saldo viejo.
    expect(page).toContain("key={reloadKey}");
  });

  it("Accesos — la redención pasa por su acción, no por el formulario", () => {
    const page = read("src/app/dashboard/parque/accesos/page.tsx");
    const validator = read("src/app/dashboard/parque/accesos/ticket-validator.tsx");
    const resources = read("src/lib/resources.ts");

    // El estado de consumo salió del CRUD genérico: editarlo a mano permitía
    // revivir un pase redimido o devolver el contador de entradas a cero.
    const block = /access_ticket: \{([\s\S]*?)\n  \},/.exec(resources)![1];
    const writable = /writable:\s*\[([^\]]*)\]/.exec(block)![1];
    for (const field of ['"status"', '"entries_used"', '"redeemed_at"']) {
      expect(writable, `access_ticket.writable no debe incluir ${field}`).not.toContain(field);
    }
    // Filtrar por estado sigue estando bien; lo que no puede haber es un campo
    // de formulario que lo escriba.
    const fields = /fields=\{\[([\s\S]*?)\n {8}\]\}/.exec(page)![1];
    for (const field of ['name: "status"', 'name: "entries_used"', 'name: "redeemed_at"']) {
      expect(fields, `el formulario no debe editar ${field}`).not.toContain(field);
    }

    // Y en su lugar hay una validación de puerta que consume la entrada.
    expect(validator).toContain("/redeem");
    expect(page).toContain("/void");
    expect(page).toContain("<TicketValidator");
    // La lista se recarga tras validar o anular, o mostraría el saldo viejo.
    expect(page).toContain("key={reloadKey}");
  });

  it("la vigencia de un pase se decide en un solo sitio", () => {
    // Si el listado y la puerta calcularan la vigencia por su cuenta, podrían
    // discrepar: la lista diría "vigente" y el torniquete rechazaría el pase.
    for (const rel of [
      "src/app/dashboard/ventas/tickets/page.tsx",
      "src/app/dashboard/parque/accesos/page.tsx",
      "src/app/dashboard/parque/accesos/ticket-validator.tsx",
    ]) {
      const page = read(rel);
      expect(page, `${rel} debe usar los predicados de lib/tickets`).toContain('from "@/lib/tickets"');
      expect(page, `${rel} no debe reimplementar la lista de estados cerrados`)
        .not.toContain('new Set(["redeemed"');
    }
  });

  it("las relaciones se expanden en la capa de datos, no en cada ruta", () => {
    // `tenantQuery` ignoraba en silencio las claves de expansión: las
    // referencias llegaban como uuid y quien las leía como objeto veía
    // undefined. La ruta genérica de ERP tenía además su propia copia parcial
    // —solo uno-a-uno— que se separó de la del resto de la aplicación.
    const tenant = read("src/lib/tenant.ts");
    expect(tenant).toContain('from "@/lib/supabase/expand"');
    expect(tenant).toMatch(/tenantQuery[\s\S]*?splitExpand/);
    expect(tenant).toMatch(/tenantFindOne[\s\S]*?splitExpand/);

    const erp = read("src/app/api/erp/[resource]/route.ts");
    expect(erp, "la ruta ERP no debe rehidratar por su cuenta").not.toContain("resolvePublicRefs");
    expect(erp, "el mapa de relaciones vive en lib/supabase/expand").not.toContain("const RELATION_RESOURCE");

    // `tenantAggregate` leía un `_aggregate` que el proveedor nunca produce:
    // solo podía devolver null.
    expect(tenant).not.toContain("tenantAggregate");
  });

  it("Cotizaciones — el documento completo, no una cabecera con líneas", () => {
    const page = read("src/app/dashboard/ventas/cotizaciones/page.tsx");
    const drawer = read("src/app/dashboard/ventas/cotizaciones/quote-drawer.tsx");
    const fields = read("src/app/dashboard/ventas/cotizaciones/quote-fields.ts");
    const resources = read("src/lib/resources.ts");

    expect(page).not.toContain("SimpleResource");
    expect(page).toContain('title="Cotizaciones"');
    // La vigencia real manda sobre el `status` almacenado, y se decide en el
    // dominio: la pantalla ya no lleva su propia copia de la regla.
    expect(page).toContain("function ValidityPill");
    expect(page).toContain("isExpired");
    expect(page).toContain("derivedStatus");
    expect(page).toContain("Tasa de conversión");
    expect(page).toContain("const exportCsv");

    // El alta pasa por su acción: `quote.code` es not null y único, y ninguna
    // pantalla lo pedía ni lo generaba — "Nueva cotización" fallaba en la base.
    expect(page).toContain('createPath="/api/quotes"');

    // El formulario cubre el documento entero, no seis campos sueltos.
    for (const field of [
      "contact_email", "deposit_type", "deposit_due_date", "balance_due_date",
      "inclusions", "exclusions", "cancellation_policy", "payment_terms",
      "internal_notes", "tax_percent", "follow_up_at",
    ]) {
      expect(fields, `falta ${field} en el formulario de cotización`).toContain(`"${field}"`);
    }

    // Las cuatro acciones del ciclo comercial existen y salen del dominio.
    for (const action of ["send", "decide", "convert", "revise"]) {
      expect(drawer).toContain(`/api/quotes/${"${quote._id}"}/${action}`);
    }
    for (const blocker of ["sendBlocker", "decideBlocker", "convertBlocker", "reviseBlocker"]) {
      expect(drawer, `${blocker} debe decidirlo el dominio`).toContain(blocker);
    }
    // Y las alternativas, que es lo que convierte una propuesta en una oferta.
    expect(drawer).toContain("optionBreakdown");
    expect(drawer).toContain("/options");
  });

  it("Cotizaciones — el total lo escribe el servidor, nunca el formulario", () => {
    const resources = read("src/lib/resources.ts");
    const quote = /^ {2}quote: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    const writable = /writable:\s*\[([\s\S]*?)\]/.exec(quote)![1];

    // Un total editable a mano es una promesa que el desglose no sostiene, y un
    // `status` editable deja marcar "aceptada" una propuesta que nadie recibió.
    for (const field of ['"subtotal"', '"discount"', '"total"', '"margin_percent"',
                         '"status"', '"sent_at"', '"decided_at"', '"code"', '"version"', '"order"']) {
      expect(writable, `quote.writable no debe incluir ${field}`).not.toContain(field);
    }

    // Las líneas y las alternativas se leen desde el CRUD pero se escriben por
    // las rutas que recalculan la cabecera en el mismo movimiento.
    const line = /^ {2}quote_line: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    expect(/writable:\s*\[([^\]]*)\]/.exec(line)![1].trim()).toBe("");
    const option = /^ {2}quote_option: \{([\s\S]*?)^ {2}\},/m.exec(resources)![1];
    expect(/writable:\s*\[([^\]]*)\]/.exec(option)![1].trim()).toBe("");

    // Los totales se recalculan en un solo módulo del dominio: las rutas de
    // acción tocan el estado (enviada, aceptada, convertida), nunca el importe.
    const libWriters = walk(path.join(ROOT, "src/lib")).filter((file) =>
      /tenantUpdate\([^)]*"quote"/.test(readFileSync(file, "utf8"))
    ).map((f) => path.relative(ROOT, f)).sort();
    expect(libWriters).toEqual(["src/lib/quote-service.ts"]);
    for (const route of ["send", "decide", "revise", "convert"]) {
      const src = read(`src/app/api/quotes/[id]/${route}/route.ts`);
      expect(src, `${route} no debe escribir importes a mano`).not.toMatch(/tenantUpdate\([^)]*"quote"[\s\S]{0,400}?subtotal/);
    }
  });

  it("Cotizaciones — la reserva se cobra al precio pactado, no al del catálogo", () => {
    const convert = read("src/app/api/quotes/[id]/convert/route.ts");
    const orders = read("src/app/api/orders/route.ts");
    const pricing = read("src/lib/pricing.ts");

    // Volver a calcular el precio al convertir le cobraría al cliente algo
    // distinto de lo que aceptó: esa es la razón de ser de una cotización.
    expect(convert).toContain("unit_price_override");
    expect(pricing).toContain("unitPriceOverride");
    expect(pricing).toContain('price_source: negotiated ? "quote" : "catalog"');

    // Y ese precio solo lo fija el servidor: por HTTP no entra, o el punto de
    // venta se convertiría en un formulario de "pon tú el precio".
    expect(orders).toContain("delete item.unit_price_override");
    expect(orders).toContain("delete item.cost_override");
  });

  it("CRM — el origen del lead usa el dominio real, no el canal de venta", () => {
    // BUG corregido: el formulario ofrecía CHANNEL, cuyos valores propios
    // ('direct', 'b2b_portal', 'tour_center', 'ota', 'pos') violan el check de
    // `lead.source`, y no dejaba elegir referido, hotel ni campaña.
    const labels = read("src/lib/labels.ts");
    expect(labels).toContain("export const LEAD_SOURCE");
    for (const source of ["walk_in", "referral", "web", "whatsapp", "social", "hotel", "agency", "campaign", "phone", "other"]) {
      expect(labels).toMatch(new RegExp(`\\n  ${source}: def\\(`));
    }
    const page = read("src/app/dashboard/crm/page.tsx");
    expect(page).toContain('name: "source", label: "Origen", type: "select", options: optionsFrom(LEAD_SOURCE)');
    expect(page).not.toContain('optionsFrom(CHANNEL)');
  });

  it("CRM — la bitácora de actividades existe y alimenta la cola de seguimiento", () => {
    // `crm_activity` ya venía expandida por el recurso `lead` y ninguna
    // pantalla la usaba, pese a que el módulo prometía "actividades".
    expect(read("src/lib/resources.ts")).toContain("crm_activity: { _limit: 100");
    const drawer = read("src/app/dashboard/crm/lead-drawer.tsx");
    expect(drawer).toContain('api.post("/api/erp/crm_activity"');
    expect(drawer).toContain("/api/erp/crm_activity/${activity._id}");
    // Agendar sincroniza la próxima acción del lead, que es de donde sale la cola.
    expect(drawer).toContain("next_action_at: form.due_at");
    const page = read("src/app/dashboard/crm/page.tsx");
    expect(page).toContain("Tu cola de seguimiento");
    expect(page).toContain("overdueAction");
  });

  it("CRM — el valor del pipeline no mezcla divisas", () => {
    const page = read("src/app/dashboard/crm/page.tsx");
    expect(page).toContain("function sumByCurrency");
    // Antes: formatMoney(pipelineValue, "usd") sobre leads de cualquier moneda.
    expect(page).not.toContain('formatMoney(pipelineValue, "usd")');
    expect(page).not.toContain('formatMoney(wonValue, "usd")');
  });

  it("las pruebas de base de datos se ejecutan en cada cambio", () => {
    // Un `check` que solo corre si alguien se acuerda no protege nada: las
    // pruebas de dominio, cascada y aislamiento entre inquilinos estaban
    // escritas y ninguna tubería las lanzaba.
    expect(read(".github/workflows/ci.yml")).toContain("bash scripts/db-test.sh");
  });

  it("existe una prueba de base de datos de la RPC del panel", () => {
    const sql = read("supabase/tests/dashboard_summary.test.sql");
    expect(sql).toContain("public.dashboard_summary");
    expect(sql).toContain("rollback");
  });

  it("B1/B2/B6 — la vista persiste en la URL, filtra por rol y cancela peticiones", () => {
    const page = read("src/app/dashboard/_components/panel-empresa.tsx");
    // B1: sincroniza periodo/rankBy/filtros con la URL.
    expect(page).toContain("window.history.replaceState");
    expect(page).toContain("window.location.search");
    // B2: los filtros de vendedor/tour center solo para roles con visión global.
    expect(page).toContain("data?.permissions.canViewGlobalRankings && (");
    // B6: aborta la petición anterior en vuelo.
    expect(page).toContain("new AbortController()");
    expect(page).toContain("controller.signal");
  });

  it("B3 — hay una alerta de tasa de cancelación elevada", () => {
    expect(read("src/app/api/dashboard/route.ts")).toContain("Tasa de cancelación elevada");
  });

  it("B4 — el RPC agrupa los canales secundarios en 'otros'", () => {
    const migration = read("supabase/migrations/0028_dashboard_channel_otros.sql");
    expect(migration).toContain("where rn <= 5");
    expect(migration).toContain("'otros', 'otros'");
    // 'otros' es un bucket sintético del RPC, no un canal: se etiqueta en la
    // pantalla y NO en CHANNEL, que alimenta selects atados al enum
    // sales_channel y rechazaría ese valor.
    expect(read("src/app/dashboard/_components/panel-empresa.tsx")).toContain("function channelLabel");
    expect(read("src/lib/labels.ts")).not.toContain('otros: def("Otros"');
  });

  it("B5 — el indicador de tendencia tiene estado neutro para 0%", () => {
    const card = read("src/components/tf/kpi-card.tsx");
    expect(card).toContain('"flat"');
    expect(card).toContain("ArrowRight");
  });

  it("los filtros del dashboard usan opciones legibles y no campos manuales por ID", () => {
    const page = read("src/app/dashboard/_components/panel-empresa.tsx");
    expect(page).toContain("function OptionFilter");
    expect(page).toContain('/api/erp/${resource}?limit=100&includeTotal=false');
    expect(page).toContain('aria-label={label}');
    expect(page).not.toContain('placeholder={`${label} ID`}');
  });
});

describe("pantallas satélite de Mi día", () => {
  it("Aprobaciones usa la fila revisable y no el ERP genérico", () => {
    const source = read("src/app/dashboard/administracion/aprobaciones/page.tsx");
    expect(source).not.toContain("SimpleResource");
    expect(source).toContain("<PageHeader title=\"Aprobaciones\" />");
    expect(source).toContain("<ApprovalRow");
    expect(source).toContain("pendingFor(ctx");
    expect(source).not.toContain("eyebrow=");
  });

  it("Tareas muestra las tareas del usuario y reutiliza la acción rápida", () => {
    const source = read("src/app/dashboard/inicio/tareas/page.tsx");
    expect(source).not.toContain("SimpleResource");
    expect(source).toContain('title="Tareas"');
    expect(source).toContain("<TaskRow");
    expect(source).toContain("listFilter(filter, ctx.userId");
    expect(source).not.toContain("eyebrow=");
  });

  // Las dos reglas siguientes valían solo para la ruta genérica de ERP, que
  // tenía su propia copia de la resolución. Ahora viven en la capa de datos, así
  // que rigen para TODA consulta con ámbito de empresa.
  it("las referencias de usuario se resuelven como nombre, no como correo", () => {
    const expand = read("src/lib/supabase/expand.ts");
    expect(expand).toContain("resolveUserNames");
    expect(expand).toContain("USER_REF_FIELDS");
    expect(expand).toContain("Usuario sin nombre registrado");
    expect(expand).not.toContain("email:");
    expect(read("src/app/api/erp/[resource]/route.ts")).not.toContain("email:");
  });

  it("las referencias públicas se resuelven por lote, nunca fila a fila", () => {
    const expand = read("src/lib/supabase/expand.ts");
    expect(expand).toContain("relationResource");
    expect(expand).toContain("_filter: { _id: { in: ids } }");
    // Una consulta por relación: el `in` recibe todos los ids de la página.
    expect(expand).toContain("[...new Set(rows.map(");
  });
});

describe("consistencia de contadores", () => {
  it("el badge del menú y el módulo usan la misma función de dominio", () => {
    expect(read("src/app/dashboard/layout.tsx")).toContain("countDecidableFor(ctx)");
    expect(read("src/app/dashboard/inicio/mi-dia/_components/sections.tsx"))
      .toContain("countDecidableFor(ctx)");
  });

  it("el badge ya no repite la lista de roles a mano", () => {
    const layout = read("src/app/dashboard/layout.tsx");
    expect(layout).not.toContain('["superadmin", "owner", "admin", "manager"].includes');
    expect(layout).not.toContain('tenantCount(companyId, "approval_request"');
  });

  it("la pantalla de aprobaciones delega el ámbito en el servidor", () => {
    // El ámbito vive en el armador de filtros compartido, así que lo aplican
    // por igual el listado y la exportación: un manager exportando aprobaciones
    // no puede llevarse las que no le toca decidir.
    const query = read("src/lib/erp-query.ts");
    expect(query).toContain("decidableFilter(ctx)");
    // Y sin ámbito decidible NO se devuelve todo: se devuelve nada.
    expect(query).toMatch(/if \(!decidable\) return \{ _none: true \}/);
    expect(read("src/app/dashboard/administracion/aprobaciones/page.tsx")).toContain("decidable");
  });
});

describe("blindaje del flujo de aprobación", () => {
  it("el ERP genérico no puede escribir el ciclo de vida de una solicitud", () => {
    const source = read("src/lib/resources.ts");
    const block = /approval_request: \{([\s\S]*?)\n  \},/.exec(source)![1];
    const writable = /writable: \[([\s\S]*?)\]/.exec(block)![1];
    for (const field of ["status", "requested_by", "approved_by", "second_approver", "requires_two", "decided_at"]) {
      expect(writable).not.toContain(`"${field}"`);
    }
  });

  it("la ruta de decisión comprueba el origen y limita la tasa", () => {
    const route = read("src/app/api/approvals/[id]/decide/route.ts");
    expect(route).toContain("assertSameOriginMutation(req)");
    expect(route).toMatch(/assertRateLimit\(\{/);
  });

  it("las tareas tienen dueño y el ERP lo verifica", () => {
    expect(read("src/lib/resources.ts")).toContain('task: "assigned_to_id"');
    expect(read("src/app/api/erp/[resource]/[id]/route.ts")).toContain("ownershipFieldFor(def.table)");
  });

  it("ningún cliente usa la clave de servicio", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return source.includes('"use client"') && source.includes("supabaseService");
      })
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });
});

describe("blindaje CSRF de las rutas mutantes", () => {
  // Toda ruta que acepta POST/PUT/PATCH/DELETE con sesión por cookie debe
  // verificar el origen. Quedan excluidas las rutas autenticadas por firma o
  // secreto (stripe/webhook, cron/*) y los cálculos de solo lectura
  // (pricing/quote), que no mutan estado.
  const csrfExempt = [
    /^src\/app\/api\/stripe\/webhook\//,
    // El webhook de MembeGo lo firma una máquina con HMAC sobre el cuerpo
    // crudo: esa firma ES la prueba de identidad que el CSRF aproxima.
    /^src\/app\/api\/membego\/webhook\//,
    /^src\/app\/api\/cron\//,
    /^src\/app\/api\/pricing\/quote\//,
    // El motor público: no hay sesión con cookies que proteger —ese es justo
    // el caso de uso—, así que exigir mismo origen no aportaría seguridad y sí
    // rompería el formulario. Lo que la protege es el límite por IP, el campo
    // trampa, el tope de personas y que NADA con valor económico se acepte del
    // cliente; hay guardas propias para las tres cosas.
    /^src\/app\/api\/public\//,
    // La API de socios se autentica con una LLAVE en la cabecera, no con
    // cookies: no hay sesión que un sitio ajeno pueda usar sin querer, que es
    // justo lo que el CSRF protege. Lo que la protege es la llave, su alcance,
    // su límite por llave y la idempotencia obligatoria.
    /^src\/app\/api\/v1\//,
    // El conector OCTO es lo mismo con otro nombre: un servidor de una OTA
    // llamando con una llave en la cabecera, sin navegador y sin cookies. La
    // exención es de la FORMA; hay guarda propia que exige que TODA ruta que
    // escribe autentique la llave con alcance de escritura.
    /^src\/app\/api\/octo\/v1\//,
    // La encuesta de después del viaje: igual que el motor público, no hay
    // sesión con cookies que proteger —el pasajero no tiene cuenta ni la va a
    // tener—. Lo que la protege es lo POCO que el token puede hacer: poner una
    // nota, escribir un comentario y darse de baja. Nada que mueva dinero,
    // nada que enseñe datos de otro cliente, y caduca a los treinta días.
    /^src\/app\/api\/opinar\//,
  ];

  it("toda ruta mutante verifica el origen de la solicitud", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "src/app/api"))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (csrfExempt.some((re) => re.test(rel))) continue;
      const source = readFileSync(file, "utf8");
      const isMutating = /export async function (POST|PUT|PATCH|DELETE)\(/.test(source);
      if (!isMutating) continue;
      if (!source.includes("assertSameOriginMutation(req)")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("acciones sensibles fuera del render", () => {
  it("la expiración de solicitudes ocurre en mantenimiento, no al pintar la pantalla", () => {
    expect(read("src/app/api/maintenance/reconcile-drafts/route.ts")).toContain("expireApprovals(ctx.companyId)");
    const files = walk(path.join(ROOT, "src/app/dashboard/inicio/mi-dia"));
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toContain("expireApprovals");
    }
  });

  it("la caducidad automática está programada y protegida por un secreto", () => {
    const cron = read("src/app/api/cron/expire-approvals/route.ts");
    expect(cron).toContain("process.env.CRON_SECRET");
    expect(cron).toContain("Bearer ${secret}");

    const vercel = JSON.parse(read("vercel.json"));
    const paths = (vercel.crons ?? []).map((c: { path: string }) => c.path);
    expect(paths).toContain("/api/cron/expire-approvals");
    expect(read(".env.example")).toContain("CRON_SECRET=");
  });

  it("ninguna ruta de cron se puede ejecutar sin credencial", () => {
    for (const file of walk(path.join(ROOT, "src/app/api/cron"))) {
      if (!file.endsWith("route.ts")) continue;
      expect(readFileSync(file, "utf8")).toContain("CRON_SECRET");
    }
  });

  it("el módulo no escribe en base de datos al renderizar", () => {
    const files = walk(path.join(ROOT, "src/app/dashboard/inicio/mi-dia"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("tenantUpdate");
      expect(source).not.toContain("tenantCreate");
      expect(source).not.toContain("tenantDelete");
    }
  });
});

describe("traductor de consultas", () => {
  it("ya no escapa valores con barras invertidas", () => {
    const source = read("src/lib/supabase/query-translator.ts");
    // El escapado con `\` metía las barras dentro del valor y rompía tanto las
    // búsquedas con puntos como las marcas de tiempo.
    expect(source).not.toContain('replace(/([,.()])/g, "\\\\$1")');
    expect(source).toContain("BARE_VALUE");
  });
});

describe("integración con MembeGo", () => {
  it("el webhook verifica la firma sobre el cuerpo CRUDO y es idempotente por diseño", () => {
    const route = read("src/app/api/membego/webhook/route.ts");
    // El contrato firma el cuerpo TAL CUAL viaja: parsear y re-serializar el
    // JSON produce, tarde o temprano, otra cadena y una firma que no cuadra.
    expect(route).toContain("await req.text()");
    expect(route).toContain("verifyMembegoWebhook(rawBody");
    expect(route).not.toMatch(/readJson\(/);
    // Lo firma una máquina desde otro origen: la firma HMAC es la prueba de
    // identidad que el CSRF de sesión aproxima, y exigir mismo origen aquí
    // rompería la integración entera.
    expect(route).not.toMatch(/assertSameOriginMutation\(/);
    // Empresa sin vínculo → 503: el reintento horario de MembeGo lo resuelve
    // solo. Un 200 tiraría el evento; un 4xx lo mandaría a su DEAD_LETTER.
    expect(route).toMatch(/status: 503/);

    // La idempotencia vive en el servicio: la fila con el id del sobre (clave
    // primaria) se inserta ANTES de aplicar efectos, y el duplicado responde
    // 200 sin repetirlos.
    const service = read("src/lib/membego-service.ts");
    expect(service).toContain('from("membego_event").insert(');
    expect(service).toContain('if (insertError.code === "23505") return { status: "duplicate" }');
  });

  it("el SSO de MembeGo es público, de un solo uso y con el rol a la baja", () => {
    const route = read("src/app/sso/membego/route.ts");
    expect(route).toMatch(/verifyMembegoToken\(/);
    // Un solo canje por jti, y tarifa por IP: acepta credenciales al portador.
    expect(route).toMatch(/await consumeJti\(/);
    expect(route).toMatch(/assertRateLimit\(\{/);
    // El SSO trae al EQUIPO; el cliente final tiene su portal en MembeGo.
    expect(route).toContain('"CLIENTE"');
    // La sesión se abre con el mecanismo probado del enlace de correo.
    expect(route).toContain("generateLink");
    expect(route).toContain("verifyOtp");
    // Al navegador solo el motivo GRUESO; el detalle queda en el log.
    expect(route).toContain("error=membego&motivo=");

    // Y es ruta pública en el middleware: su trabajo es CREAR la sesión que
    // el middleware exigiría. Si alguien la quita de la lista, el SSO entero
    // muere con una redirección a /login que nadie entendería.
    const middleware = read("src/middleware.ts");
    expect(middleware).toContain('"/sso/membego"');

    // El token del contrato NO es un JWT: dos partes, cortadas por el ÚLTIMO
    // punto, comparadas en tiempo constante.
    const lib = read("src/lib/membego.ts");
    expect(lib).toContain('lastIndexOf(".")');
    expect(lib).toContain("timingSafeEqual");
    // La regla de seguridad del contrato, literal: un rol desconocido cae al
    // permiso MÍNIMO, nunca al máximo.
    expect(lib).toMatch(/default:\s*\n\s*return "seller"/);
    expect(lib).not.toContain('return "superadmin"');
    expect(lib).not.toContain('return "owner"');
  });

  it("sin sesión no hay ayudas de inquilino: el servicio filtra por organización explícita", () => {
    // El SSO llega ANTES de que exista sesión y el webhook lo firma una
    // máquina: las ayudas de inquilino resolverían el cliente desde cookies
    // que no existen y leerían cero filas diciendo que no pasa nada.
    const service = read("src/lib/membego-service.ts");
    expect(service).toContain("supabaseService");
    expect(service).not.toContain("tenantQuery");
    expect(service).not.toContain("tenantCreate");
    expect(service).not.toContain("tenantUpdate");
    // Suspender cierra la puerta de verdad: el SSO nunca revive una membresía
    // desactivada.
    expect(service).toContain("La cuenta está desactivada en esta organización");

    // Las dos idempotencias del contrato son claves primarias: el segundo
    // insert choca, sin ventana entre comprobar y marcar.
    const sql = read("supabase/migrations/0041_membego.sql");
    expect(sql).toMatch(/event_id\s+text primary key/);
    expect(sql).toMatch(/jti\s+text primary key/);
  });

  /**
   * El cuerpo de UNA función, no el fichero entero.
   *
   * Mirar todo el fichero da falsos verdes y falsos rojos: `from("customer")`
   * aparece cuarenta líneas más abajo en `matchOrCreateCustomer`, que es
   * legítimo, y una guardia que lo viera ahí diría que el borrado arrasa con la
   * ficha local cuando no lo hace —o al revés, lo daría por bueno porque el
   * fichero contiene la palabra correcta en otro sitio.
   */
  function cuerpo(src: string, firma: string): string {
    const at = src.indexOf(firma);
    expect(at, `no existe ${firma}`).toBeGreaterThan(-1);
    const fin = src.indexOf("\n}\n", at);
    return src.slice(at, fin < 0 ? undefined : fin);
  }

  it("el borrado de un cliente suelta la COPIA, nunca la ficha de la organización", () => {
    const service = read("src/lib/membego-service.ts");

    // Tiene que salir ANTES del upsert del espejo: pasar por él resucitaría la
    // fila en el mismo evento que manda borrarla, y encima con los datos del
    // propio evento —así que el fantasma parecería recién sincronizado.
    const efectos = cuerpo(service, "async function applyEffects");
    const iBorrado = efectos.indexOf('"cliente.eliminado"');
    const iUpsert = efectos.indexOf(".upsert(");
    expect(iBorrado).toBeGreaterThan(-1);
    expect(iUpsert).toBeGreaterThan(-1);
    expect(iBorrado).toBeLessThan(iUpsert);

    // Y borra el ESPEJO, no `customer`. Park & Tours puede tener reservas,
    // facturas y pagos colgando de esa ficha: que MembeGo borre su cliente no le
    // da autoridad sobre la historia comercial de aquí, y un borrado en cascada
    // disparado desde otra plataforma es el fallo que nadie ve venir.
    const olvido = cuerpo(service, "async function forgetCustomer");
    expect(olvido).toContain('from("membego_customer")');
    expect(olvido).not.toContain('from("customer")');
    expect(olvido).toContain('.eq("organization_id"');
  });

  it("una edición en MembeGo no pisa la ficha que escribió alguien de aquí", () => {
    // Misma regla que el rol en `provisionSsoUser`: lo que una persona de esta
    // organización puso a mano no lo sobrescribe una plataforma de fuera. Un
    // cliente que ya compraba aquí tiene su teléfono corregido en el mostrador,
    // y perder eso a cambio de consistencia aparente es perder trabajo real.
    const refresco = cuerpo(
      read("src/lib/membego-service.ts"),
      "async function refreshLocalCustomer"
    );
    expect(refresco).toMatch(/source !== "membego"/);
    expect(refresco).toMatch(/return;/);
  });

  it("el webhook anota con la organización del VÍNCULO, no con el id de MembeGo", () => {
    // SIN COMENTARIOS: el porqué de este arreglo está escrito en la propia
    // ruta y NOMBRA a `writeAudit`. Una guarda que lea el fichero entero se
    // cumple o se incumple por lo que dice una explicación, no por lo que hace
    // el código — que es exactamente la forma de tener una guarda que no
    // guarda nada.
    const route = sinComentariosDe("src/app/api/membego/webhook/route.ts");

    // `writeAudit` con empresa pasa por las ayudas de inquilino, que resuelven
    // el cliente desde cookies de sesión. Este webhook lo firma una máquina:
    // no hay sesión, ni la va a haber. Y como la bitácora se traga su propio
    // error a propósito —no puede tumbar lo que describe—, el fallo no se ve
    // por ningún lado: una auditoría que parece estar y no está.
    expect(route).not.toContain("writeAudit");
    expect(route).toContain("auditMembego(");

    // Y el id que se anota es el LOCAL. `event.companyId` es el cuid de
    // MembeGo; `audit_log.organization_id` es `uuid`, así que ese insert no
    // falla a veces: falla siempre, con 22P02.
    expect(route).toContain("link.organization_id");
    expect(route).not.toMatch(/companyId:\s*event\.companyId/);
  });

  it("el estado de la membresía es una columna con dominio cerrado", () => {
    const sql = read("supabase/migrations/0077_membego_membership_status.sql");
    expect(sql).toMatch(/add column if not exists membership_status/);
    expect(sql).toMatch(/check \(membership_status in \('active', 'cancelled', 'expired'\)\)/);
    // El SQL va ANTES del despliegue, así que tiene que poder correrse dos
    // veces y no puede quitar nada de lo que ya funciona.
    expect(sql).not.toMatch(/drop table|drop column|delete from/i);
  });
});

describe("el plan se aplica en la API, no solo en el menú", () => {
  /**
   * Las mismas exenciones que el blindaje CSRF, por el mismo motivo: son rutas
   * que no actúan en nombre de una empresa con suscripción. El cron barre todos
   * los inquilinos, el webhook de Stripe es precisamente quien CAMBIA el estado
   * de la suscripción —bloquearlo dejaría a una empresa impagada sin poder
   * volver a pagar—, el superadmin gobierna la plataforma y `setup` crea la
   * empresa que todavía no existe.
   */
  const writeExempt = [
    /^src\/app\/api\/stripe\//,
    /^src\/app\/api\/cron\//,
    /^src\/app\/api\/superadmin\//,
    /^src\/app\/api\/membego\/webhook\//,
    /^src\/app\/api\/setup\//,
    // La API de socios tampoco tiene sesión: el inquilino sale de la llave y
    // el plan se comprueba sobre la empresa de esa llave. Hay guarda propia.
    /^src\/app\/api\/v1\//,
    // El motor público no tiene sesión de la que sacar el inquilino, así que
    // no puede llamar a `requireTenantWrite`. Comprueba el plan por su cuenta,
    // sobre la empresa del slug (`acceptsRequests`), y hay una guarda propia
    // que lo exige: la exención es de la FORMA, no del fondo.
    /^src\/app\/api\/public\//,
    // La seguridad de la propia cuenta no es una operación de la empresa: una
    // suscripción vencida no puede impedirle a nadie activar —ni QUITAR— su
    // segundo factor. Bloquearlo dejaría a alguien que acaba de desenrolar su
    // teléfono con la marca puesta y sin factores, es decir, fuera de su
    // cuenta por no pagar.
    /^src\/app\/api\/account\/mfa\//,
    // El conector OCTO tampoco tiene sesión: el inquilino sale de la llave. El
    // plan SÍ se comprueba, con `assertCanSell` sobre la empresa de esa llave,
    // y hay guarda propia que lo exige en cada ruta que vende.
    /^src\/app\/api\/octo\/v1\//,
    /**
     * Cambiar de empresa no es una operación: es navegación. No escribe nada
     * de negocio —solo pone una cookie y deja el rastro en la bitácora—, y
     * bloquearlo por una suscripción vencida tendría el efecto exactamente al
     * revés del que se busca: quien pertenece a dos empresas y tiene UNA sin
     * pagar se quedaría encerrado en la que no paga, sin poder salir a la que
     * sí. El plan se aplica en cada ruta que escribe de verdad, que es donde
     * tiene sentido.
     */
    /^src\/app\/api\/workspace\//,
    /**
     * La encuesta: lo que se escribe aquí no es una operación de la empresa,
     * es la respuesta de UN CLIENTE a algo que ya se le preguntó.
     *
     * Bloquearla por una suscripción vencida tendría dos efectos y los dos
     * malos: se perdería una opinión que la operadora ya pidió —el correo salió
     * cuando el plan estaba al día—, y la BAJA dejaría de funcionar, que es lo
     * único de este módulo que no se le puede negar a nadie por no pagar. Es el
     * mismo razonamiento que la exención del segundo factor.
     */
    /^src\/app\/api\/opinar\//,
  ];

  it("toda ruta que escribe exige una suscripción que permita escribir", () => {
    /**
     * `requireTenant` autentica; `requireTenantWrite` autentica Y comprueba que
     * la suscripción esté al día. Una ruta mutante que se quede con la primera
     * deja un agujero por el que una empresa con la prueba vencida sigue
     * registrando operaciones — y el agujero no se nota, porque todo funciona.
     *
     * Se mira la LLAMADA dentro de la función mutante, no el import: un archivo
     * con GET y POST importa las dos guardas legítimamente, así que comprobar
     * el import daría por bueno el POST que se quedó con la de lectura.
     */
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "src/app/api"))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (writeExempt.some((re) => re.test(rel))) continue;
      const source = readFileSync(file, "utf8");

      // Trocear por función exportada: cada tramo es el cuerpo de un handler.
      const marks = [...source.matchAll(/^export async function (\w+)\s*\(/gm)]
        .map((m) => ({ at: m.index ?? 0, name: m[1] }));
      for (let i = 0; i < marks.length; i++) {
        const { at, name } = marks[i];
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(name)) continue;
        const body = source.slice(at, marks[i + 1]?.at ?? source.length);
        if (!/await requireTenantWrite\(\)/.test(body)) offenders.push(`${rel} → ${name}`);
      }
    }
    expect(
      offenders,
      "estas rutas escriben sin comprobar que la suscripción lo permita"
    ).toEqual([]);
  });

  it("la lectura NUNCA se bloquea por el plan", () => {
    // El principio que sostiene todo lo demás: una empresa que no paga pierde
    // la capacidad de registrar, no el acceso a lo suyo. Un GET que exigiera la
    // guarda de escritura le secuestraría sus datos —con obligación fiscal de
    // conservarlos, además— y convertiría cada impago en una urgencia.
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "src/app/api"))) {
      const source = readFileSync(file, "utf8");
      const marks = [...source.matchAll(/^export async function (\w+)\s*\(/gm)]
        .map((m) => ({ at: m.index ?? 0, name: m[1] }));
      for (let i = 0; i < marks.length; i++) {
        const { at, name } = marks[i];
        if (name !== "GET") continue;
        const body = source.slice(at, marks[i + 1]?.at ?? source.length);
        if (/requireTenantWrite\(\)/.test(body)) {
          offenders.push(path.relative(ROOT, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders, "estas rutas bloquean una LECTURA por el estado del plan").toEqual([]);
  });

  it("el estado de la suscripción decide sobre datos que el contexto ya trae", () => {
    // Si la fecha de fin de prueba no llega al contexto, la prueba no puede
    // vencer: era exactamente el fallo que 0042 cierra, y la columna sin mapear
    // lo dejaría abierto otra vez sin que nada falle.
    const authContext = read("src/lib/supabase/auth-context.ts");
    for (const field of ["trial_ends_at", "next_billing_at", "storage_used_mb"]) {
      expect(authContext, `el contexto no trae ${field}`).toContain(`${field}: data.${field}`);
    }
    // Y la guarda no cuesta una consulta: decide con `ctx.company`.
    const tenant = read("src/lib/tenant.ts");
    expect(tenant).toMatch(/subscriptionState\(ctx\.company/);
  });

  it("el alta fija la fecha de fin de la prueba", () => {
    // Un `subscription_status = 'trial'` sin fecha no vence nunca. El alta es el
    // único momento en que se puede poner, y si alguien la quita, el producto
    // vuelve a ser gratis para siempre sin que nada falle.
    const setup = read("src/app/api/setup/route.ts");
    // La CLAVE del objeto que se inserta, no la subcadena: `toContain` daba por
    // bueno un `trial_ends_at_DESACTIVADO`, que es exactamente la forma que
    // toma este descuido cuando alguien quiere «probar algo un momento».
    expect(setup).toMatch(/^\s*trial_ends_at:/m);
    expect(setup).toMatch(/plan\?\.trial_days/);
  });

  it("los límites se cuentan desde los datos, no desde un contador", () => {
    // Un contador se desincroniza y entonces cobra de más o deja pasar de más.
    // Es la misma razón por la que `availability.ts` recalcula los pasajeros.
    const service = read("src/lib/plan-service.ts");
    expect(service).toMatch(/from\("booking"\)[\s\S]{0,200}count: "exact"/);
    expect(service).toContain("monthStart()");
    expect(service).not.toContain("usage_counter");
  });

  it("los puntos donde se crea algo con techo comprueban el techo", () => {
    const points: [string, string][] = [
      ["src/app/api/team/route.ts", "max_users"],
      ["src/app/api/orders/route.ts", "max_bookings_month"],
      ["src/app/api/erp/[resource]/route.ts", "max_products"],
      ["src/app/api/storage/upload/route.ts", "max_storage_mb"],
    ];
    for (const [file, metric] of points) {
      const source = read(file);
      expect(source, `${file} no comprueba ${metric}`).toMatch(
        new RegExp(`assertWithinLimit\\(\\s*ctx,\\s*"${metric}"`)
      );
    }
  });
});

describe("el plan se ve venir, no se choca", () => {
  it("la pantalla del plan no depende del plan", () => {
    // Una pantalla que explica por qué estás bloqueado no puede estar detrás de
    // un módulo: justo cuando hace falta sería lo primero que desaparece.
    const nav = read("src/lib/nav.ts");
    const entry = nav.slice(nav.indexOf('id: "plan"'), nav.indexOf('id: "plan"') + 400);
    expect(entry).toContain("/dashboard/administracion/plan");
    expect(entry).not.toContain("module:");
  });

  it("la lectura del plan no exige suscripción al día", () => {
    // Es el único sitio donde se explica el bloqueo: exigir escritura aquí
    // esconderia la explicación precisamente a quien está bloqueado.
    const route = read("src/app/api/plan/route.ts");
    expect(route).toMatch(/await requireTenant\(\)/);
    expect(route).not.toContain("requireTenantWrite");
  });

  it("la pantalla y la API calculan los límites con la misma función", () => {
    // Si la pantalla hiciera su propia aritmética, prometería un usuario que la
    // API rechaza. El medidor sale de `planStatus`, que usa `limitCheck`.
    const service = read("src/lib/plan-service.ts");
    expect(service).toMatch(/planStatus\(plan, /);
    expect(service).toMatch(/limitCheck\(metric, plan, used, wanted\)/);
    const screen = read("src/app/dashboard/administracion/plan/page.tsx");
    expect(screen).toContain('api.get<PlanStatus>("/api/plan")');
    // Nada de recalcular porcentajes a mano en la pantalla.
    expect(screen).not.toMatch(/used\s*\/\s*limit/);
  });

  it("el aviso del panel usa el dominio puro y lleva a la pantalla", () => {
    const shell = read("src/components/tf/app-shell.tsx");
    expect(shell).toMatch(/subscriptionState\(\{/);
    expect(shell).toContain("blockMessage(state.reason!)");
    expect(shell).toContain("/dashboard/administracion/plan");
  });
});

describe("el importador", () => {
  it("nada se escribe sin vista previa: el ensayo es el valor por defecto", () => {
    // Un importador que escribe primero y explica después es un importador que
    // nadie usa dos veces. `dryRun` distinto de `false` no escribe.
    const route = read("src/app/api/import/route.ts");
    expect(route).toMatch(/if \(body\.dryRun !== false\)/);
    // Y el camino que escribe está DESPUÉS de ese retorno, no antes.
    expect(route.indexOf("if (body.dryRun !== false)")).toBeLessThan(route.indexOf("runImport("));
  });

  it("importar exige el mismo rango que crear a mano ese recurso", () => {
    // Importar mil clientes no puede ser más fácil que crear uno.
    const route = read("src/app/api/import/route.ts");
    expect(route).toMatch(/requireAtLeast\(ctx, target\.minRole\)/);
    expect(route).toMatch(/await requireTenantWrite\(\)/);
  });

  it("el techo del plan se comprueba por TODAS las filas, antes de la primera", () => {
    // Con sitio para diez y un archivo de sesenta, fallar en la once deja al
    // cliente con diez productos importados y ninguna forma de saber cuáles.
    const service = read("src/lib/import-service.ts");
    expect(service).toMatch(/assertWithinLimit\(ctx, target\.limitMetric, toCreate\.length\)/);
    // Y antes de escribir: la comprobación precede al primer `tenantCreate`.
    expect(service.indexOf("assertWithinLimit")).toBeLessThan(service.indexOf("tenantCreate("));
  });

  it("actualizar solo toca los campos que trae el archivo", () => {
    // Pasar un objeto completo con los ausentes en null es cómo una importación
    // de teléfonos deja a toda la cartera sin correo.
    const service = read("src/lib/import-service.ts");
    expect(service).toMatch(/tenantUpdate\(ctx\.companyId, resource\.table, id, row\.values\)/);
  });

  it("toda importación queda en la bitácora con sus números", () => {
    const service = read("src/lib/import-service.ts");
    expect(service).toMatch(/action: "data_imported"/);
    expect(service).toMatch(/severity: "warning"/);
  });

  it("el parser no se apoya en split: las comas dentro de comillas son datos", () => {
    const lib = read("src/lib/import.ts");
    expect(lib).not.toMatch(/\.split\(delimiter\)/);
    expect(lib).toContain("\\uFEFF");   // el BOM de Excel se quita
    expect(lib).toMatch(/detectDelimiter/);
  });

  it("la pantalla del importador no está detrás de un plan ni de un rol alto", () => {
    // Importar es lo PRIMERO que hace una empresa nueva.
    const nav = read("src/lib/nav.ts");
    const at = nav.indexOf('id: "importar"');
    expect(at).toBeGreaterThan(0);
    const entry = nav.slice(at, at + 400);
    expect(entry).toContain("/dashboard/administracion/importar");
    expect(entry).not.toContain("module:");
  });
});

describe("las cuentas del equipo", () => {
  it("nadie otorga un rol por encima del suyo, por ninguna de las tres puertas", () => {
    /**
     * El alta, el cambio de rol y la invitación tienen que preguntar lo mismo.
     * Cerrar solo una deja el agujero abierto: bastaría con crear un usuario
     * normal y ascenderlo después, o invitarlo ya con el rol.
     */
    const team = read("src/app/api/team/route.ts");
    expect(team).toMatch(/roleDecision\(ctx\.role, role\)/);
    // Las dos llamadas —alta y cambio de rol— pasan el contexto.
    expect(team).toMatch(/assertRole\(ctx, body\.role \|\| "seller"\)/);
    expect(team).toMatch(/assertRole\(ctx, body\.role\)/);
    const invite = read("src/app/api/team/invite/route.ts");
    // La decisión de rol vive en el servicio que comparten las DOS altas
    // (equipo y vendedores): copiada, una de las dos se quedaría sin ella.
    expect(read("src/lib/team-invite.ts")).toMatch(/roleDecision\(ctx\.role, input\.role \|\| "seller"\)/);
    expect(invite).toMatch(/inviteTeamMember\(\{/);
  });

  it("la invitación nace PENDIENTE: un correo no es un acceso", () => {
    // Solo las membresías activas resuelven inquilino. Si el correo acaba en la
    // bandeja equivocada, quien lo reciba no entra a nada.
    const invite = read("src/app/api/team/invite/route.ts");
    expect(invite).toMatch(/status: "pending"/);
    expect(invite).not.toMatch(/status: "active"/);
  });

  it("solo se activa la invitación de quien acaba de demostrar que es su correo", () => {
    const callback = read("src/app/auth/callback/route.ts");
    expect(callback).toMatch(/\.eq\("user_id", data\.user\.id\)/);
    expect(callback).toMatch(/\.eq\("status", "pending"\)/);
  });

  it("el regreso desde el correo no sale de este dominio", () => {
    // Un `next` externo convertiría el dominio propio en trampolín, con la
    // sesión recién creada.
    const callback = read("src/app/auth/callback/route.ts");
    expect(callback).toMatch(/safeNextPath\(/);
    expect(callback).toMatch(/url\.origin === origin/);
  });

  it("crear cuentas y mandar correos tiene freno", () => {
    // Cada invitación manda un correo a una dirección que elige quien la pide:
    // es un emisor de correo en manos de un usuario.
    expect(read("src/app/api/team/invite/route.ts")).toMatch(/await assertRateLimit\(/);
    expect(read("src/app/api/team/route.ts")).toMatch(/await assertRateLimit\(/);
  });

  it("la pantalla de entrada ofrece recuperar la contraseña", () => {
    /**
     * `resetPassword` existía en el cliente desde el principio y NADA la
     * llamaba: olvidar la contraseña obligaba a que el administrador pusiera
     * una nueva y la dijera por chat — es decir, olvidarla obligaba a
     * compartirla.
     */
    expect(read("src/app/login/page.tsx")).toContain("/login/recuperar");
    expect(read("src/app/login/recuperar/page.tsx")).toMatch(/supabaseAuth\.resetPassword/);
  });

  it("recuperar no dice si el correo existe", () => {
    // Sería un detector de clientes: probar direcciones y saber quién usa el
    // sistema. Se mira el código SIN comentarios: el propio comentario que
    // explica por qué no se dice contiene la frase que se busca, y una guarda
    // que obliga a borrar su explicación para pasar vale menos que la
    // explicación.
    const page = read("src/app/login/recuperar/page.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(page).toMatch(/Si ese correo tiene cuenta/);
    expect(page).not.toMatch(/no (está|existe) registrad/i);
  });

  it("las dos pantallas del correo son públicas: quien llega aún no tiene sesión", () => {
    const middleware = read("src/middleware.ts");
    expect(middleware).toContain('"/auth/callback"');
    expect(middleware).toContain('"/auth/establecer-clave"');
  });

  it("la invitación reserva plaza del plan", () => {
    // Si no contara, un plan de cinco aceptaría veinte invitaciones y el tope
    // saltaría delante de alguien que ya recibió el correo.
    // Y se comprueba en el servicio compartido, así que el alta de vendedores
    // —que crea cuenta igual— no puede saltárselo por haber nacido después.
    const servicio = read("src/lib/team-invite.ts");
    expect(servicio).toMatch(/assertWithinLimit\(ctx, "max_users"\)/);
    // Antes de tocar Supabase Auth: al revés quedaría una cuenta creada sin
    // membresía, invisible en el equipo e imposible de volver a invitar.
    const cuerpo = cuerpoDe("src/lib/team-invite.ts");
    expect(cuerpo.indexOf("assertWithinLimit")).toBeLessThan(cuerpo.indexOf("inviteUserByEmail"));
    /**
     * Y la membresía nace PENDIENTE. Solo las activas resuelven inquilino, así
     * que una invitación sin aceptar no abre ninguna puerta: si el correo acaba
     * en la bandeja equivocada, quien lo reciba no entra a nada.
     */
    expect(cuerpo).toMatch(/status: "pending"/);
    for (const ruta of ["src/app/api/team/invite/route.ts", "src/app/api/sellers/invite/route.ts"]) {
      expect(read(ruta), ruta).toMatch(/inviteTeamMember\(\{/);
    }
    expect(read("src/lib/plan-service.ts")).toMatch(/\.in\("status", \["active", "pending"\]\)/);
  });
});

describe("la API de socios", () => {
  it("el inquilino sale de la LLAVE, nunca del cuerpo de la petición", () => {
    /**
     * Es la propiedad que impide lo peor: que un socio con llave de una
     * operadora cree reservas en otra pasando un identificador distinto.
     */
    const auth = read("src/lib/api-auth.ts");
    expect(auth).toMatch(/companyId: verdict\.key\.organization_id/);
    for (const file of ["src/app/api/v1/bookings/route.ts", "src/app/api/v1/products/route.ts"]) {
      expect(read(file), file).not.toMatch(/body\.(company|organization|tenant)/);
    }
  });

  it("el secreto de la llave no se guarda: solo su hash", () => {
    const sql = read("supabase/migrations/0050_api_keys.sql");
    expect(sql).toMatch(/secret_hash text not null/);
    expect(sql).not.toMatch(/secret text/);
    // Y la comparación es en tiempo constante.
    expect(read("src/lib/api-keys.ts")).toMatch(/timingSafeEqual/);
  });

  it("crear una reserva exige clave de idempotencia, y se comprueba ANTES de escribir", () => {
    /**
     * Un sistema externo reintenta: se le cae la conexión, su cola lo reencola.
     * Sin clave, cada reintento crea otra reserva y el socio descubre tres
     * reservas idénticas cuando el cliente llega al bus.
     */
    const route = read("src/app/api/v1/bookings/route.ts");
    // La COMPROBACIÓN, no la palabra: sin ella la cabecera se leería y se
    // ignoraría, que es exactamente el fallo que esto evita.
    expect(route).toMatch(/if \(!idempotencyKey\) \{/);
    expect(route).toMatch(/Falta la cabecera «Idempotency-Key»/);
    const body = route.slice(route.indexOf("export async function POST"));
    expect(body.indexOf("idempotency_key")).toBeLessThan(body.indexOf("createPublicBooking("));
    // Y la base lo hace cumplir: dos instancias a la vez no pueden duplicar.
    expect(read("supabase/migrations/0050_api_keys.sql")).toMatch(/sales_order_idempotency_idx/);
  });

  it("una llave de lectura no crea reservas", () => {
    expect(read("src/app/api/v1/bookings/route.ts")).toMatch(/requireApiKey\(req, "write"\)/);
    expect(read("src/app/api/v1/products/route.ts")).toMatch(/requireApiKey\(req, "read"\)/);
  });

  it("el plan se comprueba aunque no haya sesión", () => {
    const route = read("src/app/api/v1/bookings/route.ts");
    expect(route).toMatch(/subscriptionState\(caller\.company\)/);
    expect(route).toMatch(/status: 402/);
  });

  it("el socio ve el mismo catálogo publicado, sin costos ni proveedores", () => {
    // Que una agencia tenga llave no le da acceso al margen de la operadora.
    const products = read("src/app/api/v1/products/route.ts");
    expect(products).toMatch(/toPublicCard\(/);
    expect(products).not.toMatch(/base_cost|supplier/);
  });

  it("el límite de peticiones es POR LLAVE", () => {
    // Un socio que integra mal no puede agotarle el cupo a los demás socios
    // que comparten salida a internet.
    expect(read("src/lib/api-auth.ts")).toMatch(/key: `api:\$\{verdict\.key\.id\}`/);
  });
});

describe("las declaraciones 606 y 607", () => {
  it("el orden de las columnas vive en UN sitio", () => {
    /**
     * La DGII ajusta el formato de vez en cuando. Con el orden repartido por el
     * código, ese cambio se hace en cinco sitios y se olvida uno; con una lista
     * documentada, se hace en la lista.
     */
    const lib = read("src/lib/dgii.ts");
    expect(lib).toMatch(/export const COLUMNS_606 =/);
    expect(lib).toMatch(/export const COLUMNS_607 =/);
    // Y las líneas se arman con esa longitud: hay pruebas que lo comparan.
    expect(read("src/lib/dgii.test.ts")).toMatch(/COLUMNS_606\.length/);
    expect(read("src/lib/dgii.test.ts")).toMatch(/COLUMNS_607\.length/);
  });

  it("declarar es una LECTURA: el plan no la bloquea", () => {
    /**
     * Una empresa con la suscripción vencida sigue teniendo que declarar sus
     * impuestos. No poder sacar su 606 por no haber pagado el software
     * convertiría un problema de cobro en un incumplimiento fiscal.
     */
    const route = read("src/app/api/reports/dgii/route.ts");
    expect(route).toMatch(/await requireTenant\(\)/);
    expect(route).not.toMatch(/await requireTenantWrite\(\)/);
  });

  it("sin RNC de la empresa no se genera un archivo anónimo", () => {
    // El archivo identifica a quien declara: sin RNC no vale para nada y el
    // mensaje dice dónde ponerlo.
    const route = read("src/app/api/reports/dgii/route.ts");
    expect(route).toMatch(/no tiene RNC registrado/);
  });

  it("lo que no se puede declarar se avisa ANTES de generar el archivo", () => {
    // La DGII rechaza el archivo entero por una línea incompleta, días después
    // y sin decir cuál.
    const service = read("src/lib/dgii-service.ts");
    expect(service).toMatch(/purchaseProblems\(/);
    expect(service).toMatch(/saleProblems\(/);
    const page = read("src/app/dashboard/finanzas/declaraciones/page.tsx");
    expect(page).toMatch(/se queda fuera|se quedan fuera/);
    expect(page).toMatch(/ROW_PROBLEM_MESSAGE/);
  });

  it("el gasto puede capturar lo que el 606 exige", () => {
    // Sin estos campos el gasto existe en el sistema y no se puede declarar: el
    // contador acaba tecleándolo otra vez en un Excel.
    const gastos = read("src/app/dashboard/gastos/page.tsx");
    for (const field of ["ncf", "supplier_rnc", "itbis_amount", "goods_service_type"]) {
      expect(gastos, field).toContain(`name: "${field}"`);
    }
    const resources = read("src/lib/resources.ts");
    expect(resources).toMatch(/"ncf", "ncf_type", "ncf_modified", "supplier_rnc", "goods_service_type"/);
  });

  it("una factura sin cobros se declara a crédito, no como efectivo", () => {
    // Repartirla en efectivo «porque suele ser así» sería inventar un dato en
    // una declaración fiscal.
    const service = read("src/lib/dgii-service.ts");
    expect(service).toMatch(/credit: Math\.max\(0, total - cobrado\)/);
  });

  it("la pantalla pide validar el primer archivo con la DGII", () => {
    // El formato está construido según el envío vigente; una validación de dos
    // minutos evita un rechazo que se descubre días después.
    const page = read("src/app/dashboard/finanzas/declaraciones/page.tsx");
    expect(page).toMatch(/herramienta de la DGII/);
  });
});

describe("el check-in del guía: QR y sin señal", () => {
  it("el QR del voucher por fin se puede leer", () => {
    /**
     * El voucher lleva su QR impreso desde el kit de documentos y NADIE podía
     * leerlo: el guía miraba el papel y tecleaba el código en la puerta del
     * bus, con cuarenta personas esperando. Un QR que nadie escanea es un
     * adorno caro.
     */
    const page = read("src/app/dashboard/checkin/page.tsx");
    expect(page).toMatch(/<EscanerQR onCode=\{onScan\}/);
    const escaner = read("src/app/dashboard/checkin/_components/escaner.tsx");
    // Dos lectores: el nativo donde existe y jsQR donde no —hoy, iPhone—.
    expect(escaner).toMatch(/BarcodeDetector/);
    expect(escaner).toMatch(/await import\("jsqr"\)/);
  });

  it("escanear NO es el único camino", () => {
    // Un guía con el permiso de cámara mal dado no se puede quedar sin poder
    // embarcar a nadie.
    const escaner = read("src/app/dashboard/checkin/_components/escaner.tsx");
    expect(escaner).toMatch(/denied|unsupported/);
    expect(read("src/app/dashboard/checkin/page.tsx")).toMatch(/onKeyDown=\{\(e\) => \{ if \(e\.key === "Enter"\) search\(\); \}\}/);
  });

  it("cada embarque lleva su clave, y el servidor la usa para reconocer el reintento", () => {
    /**
     * Sin la clave hay que elegir entre aceptar dos veces el mismo voucher o
     * marcar como error un reintento que sí funcionó. Con ella se distinguen:
     * misma clave = misma petición otra vez; clave distinta = dos personas con
     * el mismo papel.
     */
    const page = read("src/app/dashboard/checkin/page.tsx");
    expect(page).toMatch(/idempotency_key: key/);
    const route = read("src/app/api/bookings/[id]/checkin/route.ts");
    expect(route).toMatch(/stored === key/);
    expect(route).toMatch(/repeated: true/);
    // Y sigue rechazando el voucher presentado por otra persona.
    expect(route).toMatch(/Esta reserva ya tiene el check-in completado/);
  });

  it("lo que el servidor rechaza no se reintenta para siempre", () => {
    const lib = read("src/lib/offline-queue.ts");
    expect(lib).toMatch(/export function shouldRetry/);
    const page = read("src/app/dashboard/checkin/page.tsx");
    expect(page).toMatch(/shouldRetry\(res\.status/);
  });

  it("el trabajador de servicio no responde escrituras desde la caché", () => {
    /**
     * Contestar «ya está» a un check-in o a un cobro que no llegó al servidor
     * sería mentir sobre algo que mueve dinero y plazas. Lo que se hace sin
     * señal lo guarda la aplicación en su cola, con su clave.
     */
    const sw = read("public/sw.js");
    expect(sw).toMatch(/request\.method !== "GET"/);
    expect(sw).toMatch(/response\.ok/);
  });

  it("la aplicación se instala y abre en el check-in", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.start_url).toBe("/dashboard/checkin");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(read("src/app/layout.tsx")).toMatch(/manifest: "\/manifest\.webmanifest"/);
  });

  it("el trabajador de servicio se registra dentro del panel, no en la raíz", () => {
    // Lo que tiene que sobrevivir sin señal es la operación; la página pública
    // y el login sin red no pueden hacer nada útil de todas formas.
    expect(read("src/app/dashboard/layout.tsx")).toMatch(/<ServiceWorkerRegistrar \/>/);
    expect(read("src/app/layout.tsx")).not.toMatch(/ServiceWorkerRegistrar/);
  });
});

describe("el motor de reservas público", () => {
  /**
   * Es la única puerta del sistema por la que entra alguien SIN cuenta, así que
   * estas guardas van contra las dos cosas que salen caras: publicar lo que
   * nadie quiso publicar, y aceptar del cliente algo que solo puede decidir el
   * servidor.
   */
  it("nada se publica sin que la empresa Y el producto lo pidan", () => {
    const sql = read("supabase/migrations/0047_public_booking.sql");
    expect(sql).toMatch(/public_booking_enabled boolean not null default false/);
    expect(sql).toMatch(/published boolean not null default false/);
    // Y no se abre ninguna política a `anon`: lo público es lo que el código
    // devuelve, no lo que una política deje ver.
    expect(sql).not.toMatch(/to anon/);
    expect(sql).not.toMatch(/create policy/);
  });

  it("la ficha pública se arma por lista blanca, no quitando campos", () => {
    /**
     * Es la diferencia entre un error y una fuga: construida quitando campos,
     * el día que alguien añada `base_cost` al producto ese dato se publicaría
     * solo, y el margen de la operadora acabaría en su propia página.
     */
    const lib = read("src/lib/public-booking.ts");
    const card = lib.slice(lib.indexOf("export function toPublicCard"), lib.indexOf("/* --------------------------------------------------- la petición"));
    for (const prohibido of ["base_cost", "supplier", "internal_notes", "product_cost"]) {
      expect(card, prohibido).not.toContain(prohibido);
    }
    // La consulta tampoco los pide: lo que no se trae no se escapa ni en un log.
    const service = read("src/lib/public-booking-service.ts");
    const select = service.slice(service.indexOf('.from("product")'), service.indexOf('.eq("organization_id", org.id)'));
    expect(select).not.toContain("base_cost");
    expect(select).not.toContain("*");
  });

  it("del cliente no se acepta nada con valor económico", () => {
    // Un motor público que acepta el precio del cliente es una tienda donde
    // cada quien pone su etiqueta.
    const lib = read("src/lib/public-booking.ts");
    const reader = lib.slice(lib.indexOf("export function readPublicRequest"), lib.indexOf("export function splitName"));
    for (const campo of ["total", "unit_price", "discount", "status", "currency"]) {
      expect(reader, campo).not.toContain(`input.${campo}`);
    }
  });

  it("la venta entra por el MISMO camino que el punto de venta", () => {
    /**
     * `createOrderWithBookings` valida cupo, calcula precio, genera comisiones,
     * arma el plan de cobro y avisa. Un segundo camino «más simple» se olvida de
     * la mitad, y esos errores aparecen semanas después en una salida
     * sobrevendida.
     */
    const service = read("src/lib/public-booking-service.ts");
    expect(service).toMatch(/createOrderWithBookings\(/);
    expect(service).not.toMatch(/from\("booking"\)\s*\.insert/);
  });

  it("el plan se comprueba aunque no haya sesión", () => {
    const service = read("src/lib/public-booking-service.ts");
    expect(service).toMatch(/subscriptionState\(/);
    const route = read("src/app/api/public/[slug]/request/route.ts");
    expect(route).toMatch(/page\.acceptsRequests/);
  });

  it("el producto pedido se valida contra el catálogo publicado", () => {
    // Sin esto, ese campo sería la forma de comprar algo que la operadora
    // decidió no vender por la web.
    const route = read("src/app/api/public/[slug]/request/route.ts");
    expect(route).toMatch(/page\.products\.find\(/);
    const availability = read("src/app/api/public/[slug]/availability/route.ts");
    expect(availability).toMatch(/page\.products\.some\(/);
  });

  it("pedir tiene un freno duro, y ver uno holgado", () => {
    const request = read("src/app/api/public/[slug]/request/route.ts");
    expect(request).toMatch(/limit: 5, windowMs: 3_600_000/);
    expect(read("src/app/api/public/[slug]/route.ts")).toMatch(/await assertRateLimit\(/);
  });

  it("una empresa sin página y un slug inventado se responden igual", () => {
    // Distinguirlos le serviría a quien prueba nombres para averiguar qué
    // empresas usan el sistema.
    const route = read("src/app/api/public/[slug]/route.ts");
    expect(route).toMatch(/page\.state !== "ok"/);
    expect(route).toMatch(/status: 404/);
  });

  it("publicar es una decisión que se toma en dos sitios, y los dos se ven", () => {
    // Activar la página es de quien administra la cuenta; publicar cada
    // excursión, de quien lleva el catálogo. Si el interruptor de la empresa no
    // estuviera en su formulario, la función existiría y nadie la encontraría.
    expect(read("src/app/api/company/route.ts")).toMatch(/"public_booking_enabled", "public_intro", "public_terms"/);
    expect(read("src/app/dashboard/configuracion/page.tsx")).toMatch(/public_booking_enabled/);
    const productos = read("src/app/dashboard/productos/page.tsx");
    expect(productos).toMatch(/name: "published"/);
    // Y se ve desde el listado: es donde alguien se pregunta si ya está en la web.
    expect(productos).toMatch(/header: "Web"/);
  });

  it("la página pública no exige sesión", () => {
    const middleware = read("src/middleware.ts");
    expect(middleware).toContain('"/api/public"');
    expect(middleware).toContain('"/reservar"');
  });
});

describe("el alcance por sucursal", () => {
  it("el campo que pide la pantalla se guarda de verdad", () => {
    /**
     * La pantalla de equipo pedía «Sucursal (opcional)» desde el principio y la
     * API la tiraba: se elegía, no pasaba nada, y el administrador creía que ya
     * había separado sus puntos de venta.
     */
    const team = read("src/app/api/team/route.ts");
    expect(team).toMatch(/branch_id: branchId/);
    expect(team).toMatch(/patch\.branch_id/);

    /**
     * Y lo mismo con el TOUR CENTER, que era el mismo fallo y más grave.
     *
     * El formulario lo pedía y lo enviaba; la API no contenía la palabra
     * `partner_id` en ninguna línea. Resultado: NINGÚN tour center podía
     * entrar, el administrador creía haberle dado acceso, y lo que había creado
     * era un usuario más de su propia empresa.
     */
    expect(team).toMatch(/resolveMembershipOrg\(ctx, body\.partner_id, rolePedido\)/);
    expect(team, "la membresía sigue colgando siempre de la operadora")
      .not.toMatch(/organization_id: ctx\.companyId,\s*\n\s*role,/);
    // Invitar era el único camino que ni siquiera lo MANDABA.
    expect(read("src/app/api/team/invite/route.ts")).toMatch(/partnerId: body\.partner_id/);
    expect(read("src/app/dashboard/configuracion/page.tsx"))
      .toMatch(/partner_id: form\.partner_id \|\| null,\n\s*\}\);/);
    expect(read("src/lib/team-invite.ts")).toMatch(/branch_id: \(input\.branch \|\| ""\)\.trim\(\) \|\| null/);
  });

  it("el listado y su exportación aplican el MISMO corte", () => {
    // Un archivo que se lleva las tres sucursales mientras la pantalla enseña
    // una es el fallo que nadie revisa, porque «lo exportó el sistema».
    const shared = read("src/lib/erp-query.ts");
    expect(shared).toMatch(/branchFilterFor\(def\.table, ctx\.branchId\)/);
    // Y ni el listado ni la exportación lo rearman por su cuenta.
    for (const file of ["src/app/api/erp/[resource]/route.ts", "src/app/api/export/[resource]/route.ts"]) {
      expect(read(file), file).not.toMatch(/branchFilterFor\(/);
    }
  });

  it("se combina con «y»: dos grupos de «o» en el mismo objeto se pisan", () => {
    /**
     * Ya no es un ámbito, son dos —sucursal y vendedor—, y por eso la comprueba
     * es la PROPIEDAD y no la línea literal: cada uno entra como un elemento
     * distinto de `_and`. Fusionados en un solo objeto, el segundo `_or`
     * pisaría al primero y decidiría él solo; con `_and` el traductor los
     * aplica uno tras otro y se cumplen los dos.
     */
    const shared = read("src/lib/erp-query.ts");
    expect(shared).toMatch(/_and: \[filter, \.\.\.scopes\]/);
    expect(shared).toMatch(/\[branchFilter, \.\.\.delActor\]\.filter\(Boolean\)/);
    // Y nadie los mete dentro del mismo objeto con `Object.assign`.
    expect(shared).not.toMatch(/Object\.assign\(filter, branchFilter\)/);
    expect(shared).not.toMatch(/Object\.assign\(filter, delActor\)/);
    // Ni el del socio, que antes se escribía directamente sobre el filtro base
    // —`filter[scope.field] = …`— y así pisaba lo que el usuario hubiera pedido
    // en vez de sumarse a ello.
    expect(shared).not.toMatch(/filter\[scope\.field\]/);
  });

  it("el ámbito del vendedor se aplica donde se lee, no solo donde se lista", () => {
    /**
     * EL AGUJERO: «el vendedor ve las ventas de todos».
     *
     * Acotar solo el listado genérico habría sido cosmético. Estas cuatro
     * puertas dan a las mismas ventas, y cada una tenía que cerrarse:
     *
     *  · `/api/erp/:recurso` y `/api/export/:recurso` — comparten
     *    `buildListFilter`, así que se cierran las dos de una vez.
     *  · `/api/erp/:recurso/:id` — el detalle NO pasa por el filtro del
     *    listado: `tenantFindOne` solo comprueba la empresa. Sin guarda
     *    bastaba con el identificador de la venta de un compañero, que sale
     *    impreso en cualquier voucher.
     *  · `/api/orders` y `/api/quotes` — arman su propio filtro y no pasan por
     *    `buildListFilter`. Son, además, las que leen las pantallas.
     */
    // El ámbito por fila —socio y vendedor— entra por un solo punto desde 4.5.
    expect(read("src/lib/erp-query.ts")).toMatch(/scopeFiltersFor\(def\.table, ctx\)/);
    expect(read("src/lib/row-scope.ts")).toMatch(/sellerFilterFor\(table, ctx\)/);

    const detalle = read("src/app/api/erp/[resource]/[id]/route.ts");
    // En la lectura…
    expect(detalle).toMatch(/assertRowInScope\(def\.table, ctx, record\)/);
    // …y en la escritura, porque `order` se edita con rango de vendedor y
    // `seller` es uno de sus campos editables: sin esto, un vendedor podía
    // coger la venta de un compañero y reatribuírsela sin haberla podido ver.
    expect(detalle).toMatch(/isSellerScoped\(def\.table\) && ctx\.role === "seller"/);
    expect(detalle).toMatch(/assertRowInScope\(def\.table, ctx, actual\)/);

    for (const [file, tabla] of [
      ["src/app/api/orders/route.ts", "order"],
      ["src/app/api/quotes/route.ts", "quote"],
    ] as const) {
      const fuente = read(file);
      expect(fuente, file).toMatch(
        new RegExp(`sellerFilterFor\\("${tabla}", ctx\\)`)
      );
      // Y el resultado se APLICA. Comprobar solo la llamada dejaba pasar la
      // peor versión del fallo: el ámbito calculado y tirado a la basura una
      // línea después, con el nombre de la función a la vista de quien revisa.
      expect(fuente, file).toMatch(/if \(sellerScope\) Object\.assign\(filter, sellerScope\);/);
    }
  });

  it("la venta se sella a quien vende, en el servicio y no en cada ruta", () => {
    /**
     * El desplegable «Vendedor» del punto de venta listaba al equipo entero y
     * quien vendía podía elegir a cualquiera: regalar su venta o quedarse la de
     * otro. Detrás va la comisión.
     *
     * El sello vive en `createOrderWithBookings`, que es el ÚNICO camino que
     * crea reservas —lo usan el punto de venta, la conversión de cotización, la
     * web, el revendedor, la lista de espera y la demo—. Puesto en la ruta, la
     * siguiente que creara órdenes nacería sin sellar.
     */
    const servicio = sinComentariosDe("src/lib/booking-service.ts");
    expect(servicio).toMatch(/ventaSelladaPorVendedor\(ctx\)/);
    expect(servicio).toMatch(/selladaPorPersona \? ctx\.sellerId/);

    // Y la pantalla no ofrece lo que la API va a ignorar: ofrecer una opción
    // que no se cumple es peor que no ofrecerla.
    const contexto = read("src/app/api/pos/context/route.ts");
    expect(contexto).toMatch(/visibleSellers = ventaSelladaPorVendedor\(ctx\)/);
    expect(contexto).toMatch(/seller_locked: ventaSelladaPorVendedor\(ctx\)/);
    expect(read("src/app/dashboard/pos/page.tsx")).toMatch(/ctx\?\.seller_locked \?/);
  });

  it("el CRUD genérico sella al crear y protege los campos que mueven dinero", () => {
    const crear = sinComentariosDe("src/app/api/erp/[resource]/route.ts");
    // La comprobación va ANTES del sello, para que el sello propio no se lea
    // como un intento de cambiar el campo…
    // Se comparan las LLAMADAS y no la primera aparición: los `import` del
    // principio del fichero harían pasar esta guarda dijera lo que dijera el
    // cuerpo de la función.
    expect(
      crear.indexOf("protectedFieldChanges(def.table")
    ).toBeLessThan(crear.indexOf("sellerStampFor(def.table"));
    // …y lo que se escribe es lo sellado, no el payload de antes.
    expect(crear).toMatch(/tenantCreate\(ctx\.companyId, def\.table, sellado\)/);
    expect(crear).toMatch(/assertSellerUserLinkable\(ctx\.companyId, sellado\)/);

    const editar = sinComentariosDe("src/app/api/erp/[resource]/[id]/route.ts");
    expect(editar).toMatch(/protectedFieldChanges\(def\.table, ctx\.role, payload, actual\)/);
    // Y el resultado se ACTÚA. Comprobar solo la llamada deja pasar la peor
    // versión del fallo —el veredicto calculado y tirado a la basura una línea
    // después, con el nombre de la función a la vista de quien revisa—, que es
    // exactamente cómo se coló una vez en `/api/orders`.
    for (const fuente of [crear, editar]) {
      expect(fuente).toMatch(
        /if \(bloqueados\.length > 0\) throw new TenantError\(protectedFieldMessage\(bloqueados\), 403\);/
      );
    }
    expect(editar).toMatch(/assertSellerUserLinkable\(ctx\.companyId, payload, id\)/);
    // Se compara contra la fila ACTUAL y no contra la presencia del campo.
    expect(editar).toMatch(/hasProtectedFields\(def\.table\)/);
  });

  it("las acciones con impacto económico sobre una fila ajena se cierran", () => {
    /**
     * El ámbito nació de lectura, y con eso quedaba cerrada la mitad: cancelar,
     * reprogramar y todo lo que se hace sobre una cotización viven en rutas
     * propias que nunca pasan por el CRUD genérico y solo miraban el RANGO.
     * Cancelar anula la comisión de quien vendió.
     */
    for (const file of [
      "src/app/api/bookings/[id]/cancel/route.ts",
      "src/app/api/bookings/[id]/reschedule/route.ts",
    ]) {
      expect(read(file), file).toMatch(/assertSellerOwnsRow\("booking", ctx,/);
    }

    /**
     * Y en las cotizaciones la guarda va en el cargador que TODAS comparten,
     * con el contexto como parámetro OBLIGATORIO: opcional, la siguiente ruta
     * se olvidaría de pasarlo y no lo notaría nadie.
     */
    const servicio = sinComentariosDe("src/lib/quote-service.ts");
    expect(servicio).toMatch(/assertSellerOwnsRow\("quote", ctx,/);
    expect(servicio).not.toMatch(/ctx\?:/);
    const rutas = walk(path.join(ROOT, "src/app/api/quotes/[id]"))
      .filter((f) => f.endsWith("route.ts"));
    expect(rutas.length, "no se encontraron rutas de cotización").toBeGreaterThan(5);
    let conCargador = 0;
    for (const file of rutas) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("loadQuoteBundle")) continue;
      conCargador += 1;
      expect(src, file).toMatch(/loadQuoteBundle\([^)]*ctx\)/);
    }
    expect(conCargador, "ninguna ruta usa el cargador").toBeGreaterThan(5);
  });

  it("la cuenta y el vínculo se crean en una sola operación", () => {
    /**
     * Dar de alta a un vendedor eran tres pasos en dos pantallas: ficha,
     * invitación y vínculo. El tercero es el que decide si esa persona ve sus
     * ventas o no ve ninguna, y es el que se olvida —no falla, no avisa, y el
     * vendedor entra a un sistema vacío—.
     */
    const ruta = sinComentariosDe("src/app/api/sellers/invite/route.ts");
    // Pide administración: crea una cuenta Y escribe la llave de identidad.
    expect(ruta).toMatch(/requireAtLeast\(ctx, "admin"\)/);
    expect(ruta).toMatch(/inviteTeamMember\(\{/);
    expect(ruta).toMatch(/assertSellerUserLinkable\(ctx\.companyId, \{ user: invitado\.userId \}, sellerId\)/);
    // El vínculo va DESPUÉS de invitar: al revés quedaría una ficha apuntando a
    // una cuenta que no existe.
    // Se comparan las LLAMADAS: los `import` del principio harían pasar esta
    // guarda dijera lo que dijera el cuerpo. (Tercera vez que muerde el mismo
    // detalle; queda escrito para no repetirlo.)
    const cuerpoRuta = cuerpoDe("src/app/api/sellers/invite/route.ts");
    expect(cuerpoRuta.indexOf("inviteTeamMember({")).toBeLessThan(cuerpoRuta.indexOf("tenantUpdate<Seller>"));
    // Y queda en la bitácora, con su texto en castellano.
    expect(ruta).toMatch(/action: "seller_account_linked"/);
    expect(read("src/lib/bitacora.ts")).toMatch(/seller_account_linked:/);

    // La pantalla lo ofrece justo donde se nota que falta: en la fila de quien
    // no tiene cuenta.
    const pantalla = read("src/app/dashboard/vendedores/page.tsx");
    expect(pantalla).toMatch(/rowActions=\{\(s: any\) => \(s\.user \|\| s\.user_id \? null :/);
    expect(pantalla).toMatch(/api\.post<[^>]*>\("\/api\/sellers\/invite"/);
  });

  it("las pantallas que enseñan dinero se niegan en el SERVIDOR", () => {
    /**
     * De 129 pantallas del panel, 5 miraban el rol en servidor y ninguna de
     * ellas era de las que enseñan dinero. El menú esconde
     * `/dashboard/comisiones` a quien no tiene rango; la URL, no.
     *
     * La guarda va en un `layout.tsx` porque las pantallas son de cliente y no
     * pueden leer la sesión — y de paso **cubre también sus subpáginas**:
     * `vendedores` protege metas, bonos, tipos y atribución de una vez.
     */
    for (const carpeta of [
      "vendedores", "comisiones", "liquidaciones", "partners",
      "personal", "rentabilidad", "deudas", "catalogo/costos",
    ]) {
      const layout = read(`src/app/dashboard/${carpeta}/layout.tsx`);
      expect(layout, carpeta).toMatch(/export default guardedLayout\("manager"\)/);
    }
    // Se EXPLICA, no se redirige: un desvío silencioso hace pensar que el
    // enlace está roto y que hay que volver a intentarlo.
    const guarda = sinComentariosDe("src/lib/page-guard.tsx");
    expect(guarda).toMatch(/if \(atLeast\(ctx\.role, minimo\)\) return <>\{children\}<\/>;/);
    expect(guarda).toMatch(/EmptyState/);
  });

  it("el apartado del vendedor distingue las TRES situaciones posibles", () => {
    /**
     * Gerente que vende, vendedor con ficha, y cuenta sin ficha. La tercera no
     * se distinguía: quien entraba sin ficha veía las mismas pantallas, todas
     * vacías, sin forma de saber si es que no había vendido nada o es que el
     * sistema no sabía quién era. Dos cosas muy distintas con la misma pinta.
     */
    const resumen = read("src/app/dashboard/mi-espacio/page.tsx");
    expect(resumen).toMatch(/if \(!sellerId\) \{/);
    expect(resumen).toMatch(/<SinFicha \/>/);
    // Y el aviso dice QUIÉN lo arregla: quien lo lee no puede hacerlo solo.
    const aviso = read("src/app/dashboard/mi-espacio/_components/sin-ficha.tsx");
    expect(aviso).toMatch(/administrador/);
    expect(aviso).toMatch(/Cuenta de acceso/);

    // Las cifras salen de `/api/dashboard`, que YA fuerza el ámbito en el
    // servidor: una ruta nueva sería un segundo sitio donde equivocarse sobre
    // qué es «lo suyo», y los dos acabarían discrepando.
    expect(resumen).toMatch(/api\.get<Panel>\("\/api\/dashboard/);
    // Y la lista NO manda un filtro por vendedor desde el navegador: un filtro
    // que decide qué ve cada quien y viaja en la dirección se puede quitar.
    const ventas = read("src/app/dashboard/mi-espacio/ventas/page.tsx");
    expect(ventas).toMatch(/api\.get<Venta\[\]>\(`\/api\/orders\?limit=/);
    expect(ventas).not.toMatch(/seller=/);

    // El rango más bajo aterriza en su apartado, y eso se decide en servidor.
    const aterrizaje = sinComentariosDe("src/app/dashboard/page.tsx");
    expect(aterrizaje).toMatch(/ctx\?\.role === "seller"\) redirect\("\/dashboard\/mi-espacio"\)/);
  });

  it("el estado de cuenta lo decide la FILA, y cada beneficiario tiene el suyo", () => {
    /**
     * Dos reglas, y la segunda es la que se olvida.
     *
     *  1. Abierta a su beneficiario, el rango deja de decidir: bastaría con
     *     cambiar el identificador de la dirección para bajarse la liquidación
     *     de un proveedor.
     *  2. Y el documento del proveedor NO es el del vendedor con otro nombre:
     *     lleva el coste de cada servicio y las retenciones dentro. Servírselo
     *     a un vendedor le entrega el margen de la empresa en un PDF.
     */
    for (const rel of [
      "src/app/api/settlements/[id]/statement/route.ts",
      "src/app/api/settlements/[id]/statement/pdf/route.ts",
    ]) {
      const src = sinComentariosDe(rel);
      expect(src, rel).toMatch(/assertSettlementBeneficiary\(ctx, cabecera\)/);
      // Y ya no se apoya en el rango, que es lo que dejó de decidir.
      expect(src, `${rel} sigue decidiendo por rango`).not.toMatch(/requireAtLeast\(ctx, "manager"\)/);
    }

    // La pantalla sirve el estado de cuenta del vendedor cuando toca…
    expect(sinComentariosDe("src/app/api/settlements/[id]/statement/route.ts"))
      .toMatch(/kind === "seller"\) return ok\(await loadSellerStatement/);
    // …y el PDF del proveedor se niega antes que entregar el que hay a mano.
    expect(sinComentariosDe("src/app/api/settlements/[id]/statement/pdf/route.ts"))
      .toMatch(/beneficiaryOf\(cabecera\)\?\.kind === "seller"/);

    // El del vendedor se escribe APARTE: el del proveedor lee `booking_cost`
    // —el coste— y el suyo lee `commission`.
    // Sin comentarios: este fichero EXPLICA en su cabecera por qué no lee
    // `booking_cost`, y una guarda que se dispara con la explicación en vez de
    // con el código comprueba lo contrario de lo que cree.
    const suyo = sinComentariosDe("src/lib/seller-settlement-service.ts");
    expect(suyo).toMatch(/"commission"/);
    expect(suyo, "el estado de cuenta del vendedor no puede leer costes").not.toMatch(/booking_cost/);
    // Y enseña el porcentaje CONGELADO, no el vigente en la ficha.
    expect(suyo).toMatch(/percentage: Number\(row\.percentage \?\? 0\)/);
  });

  it("el slug del enlace lo genera el SERVIDOR", () => {
    /**
     * `seller_link_slug_key` es único EN TODO EL SISTEMA, no por empresa.
     * Aceptarlo del navegador permite dos cosas distintas:
     *
     *  · OCUPAR los nombres del espacio compartido, incluidos los de otras
     *    empresas alojadas aquí;
     *  · IMITAR el de un compañero —`MARISOL1` frente a `MARIS0L1`— y llevarse
     *    sus visitas. El cliente teclea lo que ve en un cartel: no comprueba
     *    nada.
     */
    const recurso = sinComentariosDe("src/lib/resources.ts");
    const bloqueLink = /seller_link: \{([\s\S]*?)\n  \},/.exec(recurso)?.[1] ?? "";
    expect(bloqueLink, "no se encontró el recurso seller_link").not.toBe("");
    // Solo en `writable`: buscar POR slug es legítimo —es lo que se teclea de
    // un cartel— y prohibir la palabra en todo el bloque habría prohibido eso
    // de paso. Lo que no puede es ESCRIBIRSE.
    const escribibles = /writable: \[([\s\S]*?)\]/.exec(bloqueLink)?.[1] ?? "";
    expect(escribibles, "no se encontró writable en seller_link").not.toBe("");
    expect(escribibles, "el slug no puede escribirse desde el CRUD").not.toMatch(/"slug"/);

    const ruta = sinComentariosDe("src/app/api/attribution/links/route.ts");
    expect(ruta).toMatch(/const slug = await slugLibre\(/);
    // El cuerpo de la petición NO decide el slug.
    expect(ruta, "el slug viaja en el cuerpo").not.toMatch(/body\.slug/);
    // Ni de quién es el enlace, cuando quien lo pide es un vendedor.
    expect(ruta).toMatch(/sellerId = ctx\.sellerId;/);
    // Y queda en la bitácora: un enlace reparte atribución, o sea dinero.
    expect(ruta).toMatch(/action: "seller_link_created"/);
    expect(read("src/lib/bitacora.ts")).toMatch(/seller_link_created:/);
  });

  it("el enlace y su QR se abren a su dueño, no a cualquier rango", () => {
    /**
     * `assertSellerOwnsRow` no sirve para ABRIR: es un ámbito, y un ámbito deja
     * pasar a quien no es vendedor —a un gerente no hay nada que acotarle—, así
     * que usarlo aquí habría dejado entrar también a caja y a operaciones, que
     * no tienen ficha y para quienes «nada que acotar» significa «lo ven todo».
     */
    const qr = sinComentariosDe("src/app/api/attribution/links/[id]/qr/route.ts");
    expect(qr).toMatch(/assertGerenciaOVendedorDe\(ctx, refId\(link\.seller\)/);
    expect(qr, "el QR sigue decidiendo por rango").not.toMatch(/requireAtLeast\(ctx, "manager"\)/);

    // Y el embudo se fuerza al vendedor del contexto, ignorando la consulta.
    const embudo = sinComentariosDe("src/app/api/attribution/route.ts");
    const rama = embudo.slice(embudo.indexOf('if (ctx.role === "seller")'), embudo.indexOf("} else {"));
    expect(rama).toMatch(/sellerId = ctx\.sellerId \?\? NADIE/);
    expect(rama, "la rama del vendedor lee la consulta").not.toMatch(/searchParams/);
  });

  it("el techo de descuento se aplica en el SERVIDOR, y en los dos sitios", () => {
    /**
     * `seller.max_discount_pct` existía desde 0005, la pantalla lo pedía
     * («Descuento máximo autorizado»), se guardaba — y no se aplicaba en ningún
     * cálculo. La operadora creía haber acotado lo que sus vendedores regalan y
     * el sistema aceptaba un 90 % igual que un 5 %.
     *
     * Va en los dos sitios a propósito: lo definitivo lo decide la creación de
     * la orden, que es donde se cobra, pero el punto de venta cotiza mientras
     * el cajero teclea, y enseñar un total con un 40 % para rechazarlo al
     * confirmar es discutir con el cliente delante por un precio que el sistema
     * ya le había enseñado.
     */
    for (const rel of ["src/lib/booking-service.ts", "src/app/api/pricing/quote/route.ts"]) {
      const src = sinComentariosDe(rel);
      expect(src, rel).toMatch(/excesoDeDescuento\(/);
      // Y el veredicto se ACTÚA, no se calcula y se tira.
      expect(src, `${rel} calcula el exceso y no lo aplica`)
        .toMatch(/if \(exceso\) throw Object\.assign\(new Error\(mensajeExceso\(exceso\)\)/);
    }

    // La pantalla puede pintarlo en rojo; lo que impide el descuento es el
    // servidor. Nunca al revés.
    const regla = sinComentariosDe("src/lib/techo-descuento.ts");
    expect(regla, "sin techo declarado no puede haber techo").toMatch(/techo == null/);
  });

  it("desactivar a un vendedor apaga su enlace SIN tocar ninguna fila", () => {
    /**
     * EL CICLO DE VIDA YA ESTABA RESUELTO, Y MEJOR DE LO PLANEADO.
     *
     * El plan pedía un disparador que pusiera los enlaces en inactivo al
     * desactivar la ficha. No hace falta: `resolveLinkBySlug` comprueba el
     * estado del VENDEDOR en cada resolución, así que un vendedor desactivado
     * deja de atribuir al instante y por todos sus enlaces a la vez.
     *
     * Guardar además un estado en cada fila sería una segunda fuente de verdad
     * que puede quedarse desincronizada —y que sería asimétrica: reactivar al
     * vendedor no reactivaría los carteles—. Esta guarda existe para que nadie
     * «optimice» quitando la comprobación creyendo que sobra.
     *
     * Y el cartel impreso que sobrevive meses en un lobby no se rompe: un slug
     * que ya no resuelve manda a la portada, igual que cualquier enlace roto, y
     * el cliente sigue pudiendo comprar. Lo que se pierde es la atribución, que
     * es justo lo que se quería perder.
     */
    const servicio = sinComentariosDe("src/lib/attribution-service.ts");
    expect(servicio).toMatch(/if \(!seller \|\| seller\.status !== "active"\) return null;/);
    expect(servicio).toMatch(/\.eq\("status", "active"\)/);

    const puerta = sinComentariosDe("src/app/e/[slug]/route.ts");
    // A la portada, no a un 404 que enseñe qué slugs valen.
    expect(puerta).toMatch(/if \(!link\) return NextResponse\.redirect\(home, 302\);/);
    // Y con límite de tasa, que ya existía: sin él, probar slugs ajenos mide la
    // actividad de un competidor alojado en el mismo sistema.
    expect(puerta).toMatch(/assertRateLimit\(\{ key: rateLimitKey\(req, "attr:visit"\)/);
  });

  it("el catálogo que ve quien vende no lleva costes por NINGÚN camino", () => {
    /**
     * El plan pedía una ruta nueva (`/api/seller-portal/catalog`) para servirle
     * al vendedor un catálogo sin coste. Al mirarlo no hacía falta: los dos
     * caminos que ya existen están limpios, y por motivos distintos.
     *
     *  · `/api/pos/context` arma una LISTA BLANCA —nombra campo por campo lo
     *    que devuelve—, así que el coste no viaja por construcción y una
     *    columna nueva en `product` no se cuela sola.
     *  · `/api/erp/product` lo recorta con `field-projection.ts`.
     *
     * Una tercera ruta habría sido un tercer sitio donde equivocarse. Esta
     * guarda existe para que la lista blanca no se convierta en un `...p`
     * «para no repetir campos», que es como se pierden estas cosas.
     */
    const pos = sinComentariosDe("src/app/api/pos/context/route.ts");
    const catalogo = pos.slice(pos.indexOf("const catalog = products.map"), pos.indexOf("const bundleCatalog"));
    expect(catalogo, "no se encontró el mapeo del catálogo").not.toBe("");
    expect(catalogo, "el catálogo del punto de venta lleva el coste").not.toMatch(/base_cost/);
    expect(catalogo, "la modalidad lleva el coste").not.toMatch(/\bcost\b/);
    // Y sigue siendo lista blanca: nada de derramar el producto entero.
    expect(catalogo, "el catálogo derrama el producto entero").not.toMatch(/\.\.\.p[,\s}]/);

    // El del socio tampoco, que es de donde salió la regla.
    expect(sinComentariosDe("src/app/api/portal/catalog/route.ts")).not.toMatch(/base_cost/);
  });

  it("el alta de un socio valida el socio, y el cerrojo fuerza el rol", () => {
    const servicio = sinComentariosDe("src/lib/team-invite.ts");
    // Que sea un socio…
    expect(servicio).toMatch(/data\.kind !== "partner"/);
    // …y DE ESTA OPERADORA. Sin esto, un administrador engancha a alguien a un
    // socio de otra y ese usuario sale con la empresa equivocada en el token:
    // es cruzar el aislamiento entre inquilinos por el único sitio donde se
    // puede.
    expect(servicio).toMatch(/data\.tenant_org_id !== ctx\.companyId/);
    // El cerrojo: mientras el ámbito se decida por el NOMBRE del rol, un
    // empleado de un tour center con rol `seller` entraría al ERP interno.
    expect(servicio).toMatch(/return \{ organizationId: data\.id as string, role: "partner", esSocio: true \};/);

    // Y el equipo lista también a los suyos, o el alta funciona y la pantalla
    // sigue sin enseñar a esa persona.
    const team = sinComentariosDe("src/app/api/team/route.ts");
    expect(team).toMatch(/\.eq\("tenant_org_id", ctx\.companyId\)/);
    expect(team).toMatch(/\.in\("organization_id", orgIds\)/);
  });

  it("el recorte de columnas se aplica en los TRES sitios que sirven filas", () => {
    /**
     * Listado, detalle y exportación. Dejar uno sin migrar es el fallo que
     * nadie revisa: un archivo con el coste de cada excursión mientras la
     * pantalla no lo enseña se acepta porque «lo exportó el sistema».
     *
     * Y `READ_ROLE` no sirve aquí: negar `product` dejaría al vendedor sin
     * catálogo y rompería el punto de venta. Se proyecta, no se bloquea.
     */
    const listado = sinComentariosDe("src/app/api/erp/[resource]/route.ts");
    expect(listado).toMatch(/return ok\(projectRows\(def\.table, ctx, rows\), \{ total \}\);/);
    expect(listado).toMatch(/projectRows\(def\.table, ctx, pageRows\)/);

    expect(sinComentariosDe("src/app/api/erp/[resource]/[id]/route.ts"))
      .toMatch(/return ok\(projectRow\(def\.table, ctx, record\)\);/);

    expect(sinComentariosDe("src/app/api/export/[resource]/route.ts"))
      // Con la lista blanca del socio detrás desde 5.5: lo que la regla sujeta
      // es que el recorte por campos siga envolviendo a las filas, no la forma
      // exacta de la llamada.
      .toMatch(/buildExport\(resource, projectRows\(def\.table, ctx, rows\), \{/);
  });

  it("las pantallas distinguen «no puedo verlo» de «vale cero»", () => {
    /**
     * El recorte BORRA la clave. Con `?? 0` la pantalla convertía la ausencia
     * en una afirmación falsa sobre el negocio —una excursión que no cuesta
     * nada, un margen del 100 %, un compañero con 0 % de comisión— y nadie
     * habría sabido que estaba leyendo un hueco.
     */
    const productos = read("src/app/dashboard/productos/page.tsx");
    expect(productos).toMatch(/p\.base_cost == null \? "—"/);
    expect(productos).toMatch(/if \(p\.base_cost == null\) return "—";/);
    expect(productos).not.toMatch(/base_cost \?\? 0/);

    const vendedores = read("src/app/dashboard/vendedores/page.tsx");
    expect(vendedores).toMatch(/s\.commission_pct == null \? "—"/);
    expect(vendedores).toMatch(/s\.monthly_goal == null \? "—"/);

    expect(read("src/app/dashboard/configuracion/page.tsx")).toMatch(/m\.cost == null \? "—"/);
  });

  it("el calendario de cobros deja de estar abierto al vendedor", () => {
    // `payment_schedule` no tiene columna de vendedor —el suyo está en la
    // orden, tabla unida—, así que no se puede acotar: sube de rango.
    const recursos = read("src/lib/resources.ts");
    expect(recursos).toMatch(/payment_schedule: "manager"/);
    expect(recursos).not.toMatch(/payment_schedule: "seller"/);
  });

  it("saber QUÉ vendedor es quien llama sale de la base en cada petición", () => {
    /**
     * El vínculo vive en `seller.user_id`. Va por consulta y no en el token a
     * propósito: vincular, desvincular o desactivar una ficha tiene efecto en
     * la petición siguiente. Metido en el token, un vendedor desvinculado
     * seguiría viendo lo de su ficha hasta que su sesión se renovara.
     */
    const auth = read("src/lib/supabase/auth-context.ts");
    expect(auth).toMatch(/\.eq\("user_id", userId\)/);
    /**
     * Se resuelve para TODO el personal interno, no solo para el rango más
     * bajo: en una operadora pequeña el gerente y el dueño también venden, y
     * sin este dato su apartado propio no existiría. No les acota nada
     * —`sellerScopeApplies` solo mira al rango más bajo—, les da su vista.
     *
     * Desde la Fase 5 se resuelve TAMBIÉN para la gente de un tour center: el
     * sub-login del vendedor de un socio es exactamente eso, una persona del
     * portal que además tiene ficha. Se salta solo para quien no se acota
     * nunca: el superadministrador —incluso mientras impersona, porque quien
     * entra a mirar una empresa ajena no es vendedor de ella— y quien
     * administra la cuenta de su tour center.
     */
    expect(auth).toMatch(/ctx\.role !== "superadmin" && !esAdminDelSocio/);
    /**
     * Y la ficha del vendedor de un socio se busca ACOTADA A SU SOCIO. Sin
     * eso, un usuario de tour center cuyo correo coincidiera con el de una
     * ficha interna quedaría acotado a esa ficha, y vería las ventas de un
     * vendedor de la operadora desde el portal.
     */
    expect(auth, "la ficha del socio cuelga de su socio")
      .toMatch(/partnerId \? q\.eq\("partner_id", partnerId\) : q\.is\("partner_id", null\)/);
    expect(auth, "y se le pasa el socio de quien llama")
      .toMatch(/loadSellerId\(ctx\.companyId!, user\.id, ctx\.partnerId \?\? null\)/);
    expect(auth).toMatch(/ctx\.sellerId = await loadSellerId\(ctx\.companyId!, user\.id, ctx\.partnerId \?\? null\)/);
    // Y el panel usa ESE dato, no una segunda consulta que pueda discrepar.
    expect(read("src/app/api/dashboard/route.ts")).toMatch(/ctx\.sellerId \?\? null/);
  });

  it("la ficha del vendedor deja vincular la cuenta con la que entra", () => {
    /**
     * Sin este campo el arreglo dejaría a TODOS los vendedores fuera de sus
     * propias ventas: el sistema no tendría forma de saber cuáles son suyas.
     * La columna existía en la base desde 0005 y no había pantalla que la
     * pusiera.
     */
    const pantalla = read("src/app/dashboard/vendedores/page.tsx");
    expect(pantalla).toMatch(/name: "user", label: "Cuenta de acceso"/);
    expect(pantalla).toMatch(/optionsPath: "\/api\/team/);
    // Y se ve de un vistazo quién sigue sin vincular.
    expect(pantalla).toMatch(/Sin vincular/);
  });

  it("editar una ficha no borra la referencia que el listado no trajo", () => {
    /**
     * El formulario abre con la fila del LISTADO, que solo expande lo que su
     * recurso declara; lo demás llega como `<campo>_id`. Antes el campo salía
     * vacío y al guardar viajaba `null`: editarle el teléfono a un vendedor le
     * desvinculaba la cuenta, en silencio.
     */
    const form = read("src/components/tf/resource-form.tsx");
    expect(form).toMatch(/record\?\.\[`\$\{f\.name\}_id`\]/);
    expect(form).toMatch(/if \(record && known\) payload\[f\.name\] = null;/);
  });

  it("la venta nace en la sucursal de quien vende", () => {
    const service = read("src/lib/booking-service.ts");
    expect(service).toMatch(/branch: input\.branch_id \|\| ctx\.branchId/);
  });

  it("los catálogos NO se acotan: acotarlo todo deja al vendedor sin vender", () => {
    const lib = read("src/lib/branch-scope.ts");
    const map = lib.slice(lib.indexOf("BRANCH_SCOPED"), lib.indexOf("export function isBranchScoped"));
    for (const table of ["product:", "hotel:", "customer:", "price_rule:", "cancellation_policy:"]) {
      expect(map, `${table} no debería acotarse por sucursal`).not.toContain(table);
    }
  });

  it("la sucursal viaja en el token, no en una consulta por petición", () => {
    const sql = read("supabase/migrations/0046_branch_scope.sql");
    expect(sql).toMatch(/jsonb_build_object\('branch_id', m\.branch_id\)/);
    // Y el resto de las reclamaciones siguen ahí: la función se reescribe
    // entera porque `create or replace` lo exige, no porque cambie nada más.
    for (const claim of ["org_id", "app_role", "status", "partner_id"]) {
      expect(sql, claim).toContain(`'${claim}'`);
    }
  });
});

describe("reprogramar una reserva", () => {
  it("mueve la plaza en LAS DOS salidas", () => {
    /**
     * Si la salida de origen no recalcula, se queda con el cupo tomado por una
     * reserva que ya no está: esa salida se vende de menos el resto del mes y
     * nadie lo nota hasta que el bus sale medio vacío.
     */
    const route = read("src/app/api/bookings/[id]/reschedule/route.ts");
    expect(route).toMatch(/recalculateDeparture\(ctx\.companyId, originId\)/);
    expect(route).toMatch(/recalculateDeparture\(ctx\.companyId, targetId\)/);
  });

  it("no toca el número de reserva, el voucher ni las comisiones", () => {
    // Es la MISMA venta: regenerar comisiones cambiaría lo que cobra el
    // vendedor por algo que ya vendió, y cambiar el código dejaría sin valor el
    // papel que el cliente tiene en la mano.
    const route = read("src/app/api/bookings/[id]/reschedule/route.ts");
    expect(route).not.toMatch(/booking_number:/);
    expect(route).not.toMatch(/voucher_code:/);
    expect(route).not.toMatch(/generateCommissionsForBooking|"commission"/);
  });

  it("suelta la recogida de la ruta del día anterior", () => {
    const route = read("src/app/api/bookings/[id]/reschedule/route.ts");
    expect(route).toMatch(/"pickup"/);
    expect(route).toMatch(/route: null/);
  });

  it("cancelar también suelta su recogida", () => {
    // Era un fallo anterior: el conductor pasaba igual por el hotel a buscar a
    // alguien que había cancelado.
    const cancel = read("src/lib/booking-cancel-service.ts");
    expect(cancel).toMatch(/status: "cancelled", route: null/);
  });

  it("lo imposible no se puede forzar y lo de política sí, con rango", () => {
    const route = read("src/app/api/bookings/[id]/reschedule/route.ts");
    expect(route).toMatch(/isForceable\(blocker\)/);
    expect(route).toMatch(/if \(forced\) requireAtLeast\(ctx, "manager"\)/);
    // Y la lista de lo levantable vive en el dominio puro, no en la ruta.
    const lib = read("src/lib/reschedule.ts");
    expect(lib).toMatch(/FORCEABLE_RESCHEDULE_BLOCKS: RescheduleBlock\[\] = \["cutoff", "too_many"\]/);
  });

  it("la pantalla ofrece solo salidas del mismo producto y futuras", () => {
    // Ofrecer otras es ofrecer algo que el servidor va a rechazar.
    const page = read("src/app/dashboard/reservas/page.tsx");
    const block = page.slice(page.indexOf("const openReschedule"), page.indexOf("const reschedule ="));
    expect(block).toContain('"filter.product": productId');
    expect(block).toMatch(/dateField: "departure_at"/);
  });

  it("el cliente se entera de la fecha nueva", () => {
    // El peor momento de una reprogramación es el cliente en el lobby el día
    // que ya no es.
    const route = read("src/app/api/bookings/[id]/reschedule/route.ts");
    expect(route).toMatch(/notifyBookingRescheduled\(/);
    const templates = read("src/lib/messaging/templates.ts");
    expect(templates).toMatch(/key: "booking_rescheduled", channel: "email"/);
    expect(templates).toMatch(/key: "booking_rescheduled", channel: "whatsapp"/);
  });
});

describe("la verificación en dos pasos", () => {
  it("se exige en la API, no solo en la pantalla", () => {
    /**
     * Una contraseña robada sirve para llamar a la API directamente, que es
     * donde están los datos. Un segundo factor que solo vigila la interfaz no
     * protege de nada.
     */
    const tenant = read("src/lib/tenant.ts");
    expect(tenant).toMatch(/if \(ctx\.mfaPending\)/);
    expect(tenant).toMatch(/MFA_REQUIRED/);
  });

  it("la marca vive donde el usuario no la puede tocar", () => {
    // `user_metadata` la escribe el propio usuario con una llamada: quien
    // tuviera la contraseña robada la borraría y entraría.
    const account = read("src/app/api/account/mfa/route.ts");
    expect(account).toMatch(/app_metadata: \{ mfa_enabled/);
    expect(account).not.toMatch(/user_metadata: \{ mfa_enabled/);
  });

  it("la marca copia la realidad: no recibe «activar» ni «desactivar»", () => {
    /**
     * Si la ruta aceptara una orden, dos fallos serían posibles: marca puesta
     * sin factor —la persona fuera de su cuenta para siempre— y factor sin
     * marca, que es justo la puerta que el segundo factor venía a cerrar.
     */
    const account = read("src/app/api/account/mfa/route.ts");
    expect(account).toMatch(/listFactors\(\{ userId: ctx\.userId \}\)/);
    expect(account).toMatch(/hasVerifiedFactor\(/);
    expect(account).not.toMatch(/body\.(enabled|action)/);
  });

  it("restablecer el de otro exige rango y deja rastro crítico", () => {
    const reset = read("src/app/api/team/mfa-reset/route.ts");
    expect(reset).toMatch(/requireAtLeast\(ctx, "admin"\)/);
    expect(reset).toMatch(/atLeast\(ctx\.role, membership\.role/);
    expect(reset).toMatch(/action: "mfa_reset"/);
    expect(reset).toMatch(/severity: "critical"/);
    // Y apaga la marca junto con los factores: si quedara puesta, la persona
    // seguiría pidiéndole un código a una cuenta que ya no tiene ninguno.
    expect(reset).toMatch(/app_metadata: \{ mfa_enabled: false \}/);
  });

  it("la pantalla del código no cierra la sesión ni deja sin salida", () => {
    // Cerrarla obligaría a escribir la contraseña otra vez, que es lo que
    // empuja a desactivar el segundo factor; y sin salida, quien no tenga el
    // teléfono se queda mirando una pantalla que no avanza.
    const page = read("src/app/auth/verificar/page.tsx");
    expect(page).toMatch(/challengeAndVerify/);
    expect(page).toMatch(/No tengo el teléfono a mano/);
  });

  it("el panel manda a verificar en vez de enseñar una pantalla que no carga", () => {
    // Sin la bandera `s` (el objetivo de compilación del proyecto no la
    // admite): se busca la línea que hace las dos cosas.
    const layout = read("src/app/dashboard/layout.tsx");
    expect(layout).toMatch(/if \(ctx\.mfaPending\) redirect\("\/auth\/verificar/);
  });

  it("el perfil ya no dice que cambiar la contraseña «no está habilitado»", () => {
    // Lo estaba a medias: la función existía en el cliente y ninguna pantalla
    // la llamaba.
    const page = read("src/app/dashboard/perfil/page.tsx");
    expect(page).not.toMatch(/todavía no está habilitado/);
    expect(page).toMatch(/<Seguridad email=/);
  });
});

describe("las notificaciones internas", () => {
  /**
   * La campana estuvo cuatro migraciones enseñando un cero. Lo que la vuelve a
   * dejar así no es borrar código: es que un refactor se lleve por delante el
   * enganche y nadie lo note, porque un aviso que no se escribe no rompe nada.
   * Estas guardas atan cada evento del catálogo al sitio donde ocurre el hecho.
   */
  const HOOKS: [string, string][] = [
    ["booking_created", "src/lib/booking-service.ts"],
    ["booking_cancelled", "src/lib/booking-cancel-service.ts"],
    ["booking_rescheduled", "src/app/api/bookings/[id]/reschedule/route.ts"],
    ["payment_refunded", "src/app/api/payments/route.ts"],
    ["cash_close_mismatch", "src/app/api/cash/sessions/[id]/close/route.ts"],
    ["settlement_confirmed", "src/app/api/settlements/[id]/confirm/route.ts"],
    ["settlement_disputed", "src/app/api/settlements/[id]/dispute/route.ts"],
    ["invoice_voided", "src/lib/invoice-service.ts"],
    ["receivable_overdue", "src/app/api/cron/collections/route.ts"],
    ["quote_accepted", "src/app/api/quotes/[id]/decide/route.ts"],
    ["stock_low", "src/lib/inventory.ts"],
    ["plan_limit_near", "src/lib/plan-service.ts"],
    ["incident_opened", "src/lib/notify.ts"],
    ["certification_expiring", "src/app/api/cron/certifications/route.ts"],
    ["allotment_released", "src/app/api/cron/allotments/route.ts"],
    ["waitlist_offer", "src/lib/waitlist-service.ts"],
    ["survey_detractor", "src/lib/voice-service.ts"],
    // Los cuatro del vendedor. Van a la PERSONA (`userId`) y no a la audiencia
    // de rol: repartidos por rol, cada vendedor recibiría los avisos de las
    // ventas de sus compañeros y, de paso, sabría cuánto cobran.
    ["sale_attributed", "src/app/api/orders/route.ts"],
    ["commission_approved", "src/app/api/commissions/bulk/route.ts"],
    ["settlement_paid", "src/app/api/settlements/[id]/pay/route.ts"],
    ["booking_cancelled_for_seller", "src/app/api/bookings/[id]/cancel/route.ts"],
  ];

  it("las metas del vendedor IGNORAN el parámetro de la consulta", () => {
    /**
     * Es la diferencia entre «filtrar» y «acotar». Si la rama del vendedor
     * aceptara `?seller=` y luego comprobara que coincide, bastaría un fallo de
     * comparación —o un camino nuevo que se olvide de comprobar— para leer las
     * metas y los bonos de un compañero. Ignorándolo, ese parámetro no existe
     * para él: no hay comparación que pueda salir mal.
     */
    const src = read("src/app/api/seller-goals/route.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const rama = src.slice(src.indexOf('if (ctx.role === "seller")'), src.indexOf('requireAtLeast(ctx, "manager")'));
    expect(rama, "la rama del vendedor no existe").toContain("goalsWithProgress");
    expect(rama).toMatch(/sellerId: ctx\.sellerId \?\? NADIE/);
    expect(rama, "la rama del vendedor lee la consulta").not.toMatch(/searchParams/);
  });

  it("los avisos del vendedor van con nombre y apellido, no por rol", () => {
    /**
     * Es la diferencia entre enterarse y no enterarse. «Te aprobaron la
     * comisión» mandado a la audiencia `seller` se lo manda a TODOS los
     * vendedores de la empresa: cada uno recibe lo de sus compañeros, ninguno
     * encuentra lo suyo entre el ruido, y todos acaban sabiendo cuánto cobran
     * los demás.
     *
     * `notify` pone `audience_role` en null cuando hay `userId`, así que lo que
     * hay que fijar es que los cuatro se emitan SIEMPRE con usuario.
     */
    for (const [event, file] of [
      ["sale_attributed", "src/app/api/orders/route.ts"],
      ["commission_approved", "src/app/api/commissions/bulk/route.ts"],
      ["settlement_paid", "src/app/api/settlements/[id]/pay/route.ts"],
      ["booking_cancelled_for_seller", "src/app/api/bookings/[id]/cancel/route.ts"],
    ] as const) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      /**
       * Se mira DENTRO de la llamada a `notify`, no en una ventana de
       * caracteres alrededor: una ventana atrapa cualquier `userId,` que ande
       * cerca por otro motivo, y entonces la guarda pasa aunque el aviso se
       * emita sin usuario. (Pasó: esta comprobación no mordía.)
       */
      const donde = src.indexOf(`event: "${event}"`);
      expect(donde, `${event} no se emite desde ${file}`).toBeGreaterThan(-1);
      const inicio = src.lastIndexOf("notify({", donde);
      expect(inicio, `${event} no se emite con notify({`).toBeGreaterThan(-1);
      const llamada = src.slice(inicio, donde);
      expect(llamada, `${event} se emite sin usuario`).toMatch(/\buserId,/);
      // Y sin cuenta vinculada NO se avisa a nadie: un aviso personal sin
      // persona no puede convertirse en un aviso para todo el mundo.
      expect(src, `${event} no comprueba que haya cuenta`).toMatch(/usuarioDeVendedor\(/);
      expect(src, `${event} avisa aunque no haya cuenta`).toMatch(/if \(!?userId/);
    }
  });

  it("cada evento del catálogo se dispara desde algún sitio", () => {
    // Un evento en el catálogo que nadie emite es una promesa que el sistema no
    // cumple, y es exactamente el estado del que venimos.
    const catalogo = read("src/lib/notify.ts");
    const declarados = [...catalogo.matchAll(/^  ([a-z_]+): \{$/gm)].map((m) => m[1]);
    expect(declarados.sort()).toEqual(HOOKS.map(([event]) => event).sort());
  });

  it("el enganche vive donde ocurre el hecho", () => {
    for (const [event, file] of HOOKS) {
      expect(read(file), `${event} debería emitirse desde ${file}`).toContain(`"${event}"`);
    }
  });

  it("escribir un aviso no puede tumbar la operación que lo provocó", () => {
    /**
     * Se llama sin try/catch desde una venta ya cobrada y desde un cierre de
     * caja: la función se traga sus propios errores. Si dejara de hacerlo, un
     * fallo de la base al escribir un aviso revertiría un cobro.
     */
    const service = read("src/lib/notify-service.ts");
    const body = service.slice(service.indexOf("export async function notify"));
    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch \(err\)/);
    // Y no relanza: ni `throw` propio ni un `Promise.reject`.
    expect(body).not.toMatch(/\bthrow\b/);
  });

  it("los avisos se escriben con el rol de servicio, que es el que sirve en un cron", () => {
    // La cobranza y el barrido de existencias corren sin sesión: bajo RLS, las
    // ayudas de inquilino resolverían cero filas y el aviso no se escribiría.
    const service = read("src/lib/notify-service.ts");
    expect(service).toMatch(/supabaseService\(\)/);
    expect(service).toMatch(/organization_id: input\.companyId/);
  });

  it("la clave de dedupe la guarda la base, no solo la aplicación", () => {
    // Dos instancias escribiendo a la vez dejarían dos copias si el único
    // control fuera un `select` previo desde la aplicación.
    const sql = read("supabase/migrations/0044_notifications.sql");
    expect(sql).toMatch(/create unique index if not exists notification_dedupe_idx/);
    expect(sql).toMatch(/on notification \(organization_id, dedupe_key\)/);
  });
});

describe("el límite de peticiones", () => {
  it("TODA llamada lleva await: sin él, el límite deja de existir en silencio", () => {
    /**
     * `assertRateLimit` es asíncrona desde 0043. Una llamada sin `await`
     * devuelve una promesa que nadie mira: la petición sigue de largo, el 429
     * nunca se lanza y no falla nada a la vista —el límite simplemente deja de
     * aplicarse—. Es el fallo más caro posible de esta refactorización, así que
     * se vigila en las setenta y cinco llamadas a la vez.
     */
    const offenders: string[] = [];
    for (const dir of ["src/lib", "src/app", "src/components"]) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (!/\.tsx?$/.test(file)) continue;
        const rel = path.relative(ROOT, file).replace(/\\/g, "/");
        if (rel === "src/lib/rate-limit.ts" || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
        readFileSync(file, "utf8").split("\n").forEach((line, index) => {
          if (/(?<!await )assertRateLimit\(/.test(line)) offenders.push(`${rel}:${index + 1}`);
        });
      }
    }
    expect(offenders, "estas llamadas al limitador no se esperan, así que no limitan").toEqual([]);
  });

  it("el contador compartido va por el rol de servicio, no por la sesión", () => {
    /**
     * Esto corre también ANTES de que haya sesión —el intento de contraseña es
     * justo donde más falta hace—, y la función de la base está vedada a `anon`
     * y a `authenticated` a propósito: si la pudiera llamar el cliente,
     * inflaría el contador de la clave de OTRA persona hasta dejarla fuera.
     */
    const lib = read("src/lib/rate-limit.ts");
    expect(lib).toMatch(/supabaseService\(\)/);
    expect(lib).not.toMatch(/supabaseServer\(/);
    expect(lib).toMatch(/rpc\("rate_limit_hit"/);
  });

  it("si la base falla, degrada a la memoria en vez de abrirse", () => {
    // Un limitador caído no puede tumbar el sistema, pero tampoco desaparecer.
    const lib = read("src/lib/rate-limit.ts");
    const shared = lib.slice(lib.indexOf("async function hitShared"), lib.indexOf("export interface RateLimitOptions"));
    expect(shared).toMatch(/catch/);
    expect(shared).toMatch(/return null/);
    // Y el veredicto local se aplica ANTES de consultar la base.
    const assert = lib.slice(lib.indexOf("export async function assertRateLimit"));
    expect(assert.indexOf("hitLocal(")).toBeLessThan(assert.indexOf("hitShared("));
  });

  it("la función de la base existe con la firma que la aplicación llama", () => {
    // Una migración que renombre el parámetro dejaría el límite degradado a
    // memoria en producción, en silencio y para siempre.
    const sql = read("supabase/migrations/0043_rate_limit.sql");
    expect(sql).toMatch(/function public\.rate_limit_hit\(p_key text, p_limit integer, p_window_ms integer\)/);
    expect(sql).toMatch(/grant execute on function public\.rate_limit_hit\(text, integer, integer\) to service_role/);
    expect(sql).toMatch(/revoke execute on function public\.rate_limit_hit\(text, integer, integer\) from anon/);
  });
});

describe("higiene del código fuente", () => {
  it("ningún carácter invisible se cuela en el fuente", () => {
    /**
     * Escribir `\uFEFF` o `̀-ͯ` y que en el archivo acabe el CARÁCTER
     * en vez de la secuencia funciona igual en ejecución y es ilegible al leer:
     * un rango de diacríticos combinantes se ve como dos marcas sueltas sobre
     * un corchete, y un BOM no se ve en absoluto. Pasó escribiendo el
     * importador, y las cuatro pantallas de exportación lo arrastraban desde
     * antes sin que nadie lo notara.
     *
     * Peor que ilegible: un carácter invisible es la forma clásica de esconder
     * algo en una revisión de código, así que un fuente sin invisibles es
     * también una propiedad de seguridad que sale gratis.
     */
    const INVISIBLE = /[̀-ͯ\uFEFF​-‍⁠­]/;
    const offenders: string[] = [];
    for (const dir of ["src/lib", "src/app", "src/components"]) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (!/\.tsx?$/.test(file)) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        const at = lines.findIndex((line) => INVISIBLE.test(line));
        if (at >= 0) offenders.push(`${path.relative(ROOT, file).replace(/\\/g, "/")}:${at + 1}`);
      }
    }
    expect(offenders, "estos archivos traen caracteres invisibles en el fuente").toEqual([]);
  });
});

describe("las exportaciones", () => {
  it("exportar es una LECTURA: el bloqueo por plan no se la quita al cliente", () => {
    /**
     * Desde 0042 una empresa bloqueada conserva «consultar y exportar», y el
     * mensaje del bloqueo se lo promete por escrito. Si esta ruta exigiera
     * suscripción al día, esa promesa sería falsa justo cuando más importa:
     * dejar de pagar le impediría llevarse sus propios datos.
     */
    const route = read("src/app/api/export/[resource]/route.ts");
    expect(route).toMatch(/await requireTenant\(\)/);
    // La LLAMADA, no la palabra: el comentario de la ruta explica por qué NO se
    // usa la guarda de escritura, y ese comentario vale más que una guarda que
    // obligue a borrarlo para pasar.
    expect(route).not.toMatch(/await requireTenantWrite\(\)/);
  });

  it("la exportación aplica la MISMA autorización de lectura que el listado", () => {
    /**
     * Sin esto, un rol que no puede ver un recurso en pantalla se lo llevaría
     * entero en un archivo.
     *
     * Y ya no basta con que las TRES rutas contengan la misma condición
     * copiada: desde que hay excepciones por actor —el socio, y el vendedor
     * sobre su propio dinero— la condición tiene ramas, y tres copias de algo
     * con ramas divergen. Lo que se comprueba ahora es que las tres llamen a
     * la MISMA función y que ninguna se guarde una copia propia.
     */
    for (const file of [
      "src/app/api/erp/[resource]/route.ts",
      "src/app/api/erp/[resource]/[id]/route.ts",
      "src/app/api/export/[resource]/route.ts",
    ]) {
      const route = read(file);
      expect(route, file).toMatch(/assertCanReadTable\(ctx, def\.table\)/);
      expect(route, `${file} se guarda una copia de la regla`).not.toMatch(/readRoleFor\(def\.table\)/);
    }
  });

  it("el listado y su exportación comparten el armado del filtro", () => {
    /**
     * Copiado en dos sitios, la divergencia es cuestión de tiempo y se
     * manifiesta de la peor forma: un archivo que dice traer los datos
     * filtrados y trae otros, que nadie revisa porque «lo exportó el sistema».
     */
    const list = read("src/app/api/erp/[resource]/route.ts");
    const exportRoute = read("src/app/api/export/[resource]/route.ts");
    for (const source of [list, exportRoute]) {
      expect(source).toMatch(/buildListFilter\(def, ctx, sp\)/);
      expect(source).toMatch(/buildListSort\(def, sp\)/);
    }
    // Y ninguna de las dos rearma el filtro por su cuenta.
    for (const source of [list, exportRoute]) {
      expect(source).not.toContain("allowedFilterFields(");
      expect(source).not.toContain("partnerScopeFor(");
    }
  });

  it("un filtro imposible devuelve nada, nunca todo", () => {
    // `_none` sale del ámbito de aprobaciones cuando el rol no puede decidir
    // ninguna. Ignorarlo convertiría «ninguna» en «todas», que es la fuga.
    for (const file of ["src/app/api/erp/[resource]/route.ts", "src/app/api/export/[resource]/route.ts"]) {
      expect(read(file), file).toMatch(/filter\._none/);
    }
  });

  it("el archivo no se guarda en ninguna caché intermedia", () => {
    // La siguiente persona pediría el mismo recurso y podría recibir el archivo
    // de otra empresa.
    const route = read("src/app/api/export/[resource]/route.ts");
    expect(route).toMatch(/"Cache-Control": "no-store, private"/);
  });

  it("toda exportación queda en la bitácora", () => {
    // Sacar la cartera de clientes en un archivo es justo el movimiento que
    // alguien querría poder revisar después.
    const route = read("src/app/api/export/[resource]/route.ts");
    expect(route).toMatch(/action: "data_exported"/);
  });

  it("el botón vive en el componente compartido, no pantalla por pantalla", () => {
    // Puesto en cada pantalla, la número 36 se queda sin él y nadie se entera.
    const shared = read("src/components/tf/resource-page.tsx");
    expect(shared).toMatch(/\/api\/export\/\$\{resource\}/);
    expect(shared).toMatch(/aria-label="Exportar a CSV"/);
  });

  it("exporta lo que se ve, con los mismos parámetros que el listado", () => {
    const shared = read("src/components/tf/resource-page.tsx");
    const block = shared.slice(shared.indexOf("const exportar ="), shared.indexOf("const actionColumn"));
    // Búsqueda, filtros fijos, filtros del usuario y orden: los cuatro.
    expect(block).toContain('qs.set("q", search)');
    expect(block).toContain("fixedFilters");
    expect(block).toContain("filterValues");
    expect(block).toContain('qs.set("sort", initialSort)');
    // Y NO manda paginación: exportar veinticinco de trescientas no es exportar.
    expect(block).not.toContain('qs.set("limit"');
    expect(block).not.toContain('qs.set("offset"');
  });

  it("llevarse la empresa entera tampoco lo bloquea el plan", () => {
    // Misma promesa que el listado, y aquí pesa más: es el archivo que le
    // permite a un cliente irse. Condicionarlo al pago sería un rehén.
    const route = read("src/app/api/export/company/route.ts");
    expect(route).toMatch(/await requireTenant\(\)/);
    expect(route).not.toMatch(/await requireTenantWrite\(\)/);
  });

  it("el volcado completo exige administrador y deja rastro crítico", () => {
    /**
     * Es la copia entera del negocio: clientes, precios, comisiones y
     * contabilidad. Un vendedor no la descarga, y quien la descarga queda en la
     * bitácora — es exactamente el movimiento que alguien querría revisar
     * después de una salida conflictiva.
     */
    const route = read("src/app/api/export/company/route.ts");
    expect(route).toMatch(/requireAtLeast\(ctx, "admin"\)/);
    expect(route).toMatch(/action: "company_data_exported"/);
    expect(route).toMatch(/severity: "critical"/);
    expect(route).toMatch(/"Cache-Control": "no-store, private"/);
  });

  it("la pantalla pide el mismo rol que la ruta, y lo explica", () => {
    // Enseñar el botón a quien la API va a rechazar produce un 403 que se lee
    // como «algo se rompió».
    const page = read("src/app/dashboard/administracion/exportar/page.tsx");
    expect(page).toMatch(/atLeast\(ctx\.role, "admin"\)/);
  });

  it("el volcado no expande relaciones: fiel y del tamaño que cabe", () => {
    // Expandir ochenta y ocho tablas multiplica las consultas y agota el tiempo
    // de la función. Los identificadores se cruzan dentro del propio archivo.
    const service = read("src/lib/company-export-service.ts");
    expect(service).not.toMatch(/def\.expand/);
    expect(service).toMatch(/keepTimestamps: true/);
  });

  it("«llévate tus datos» no depende del plan ni se esconde en el menú", () => {
    const nav = read("src/lib/nav.ts");
    const item = nav.slice(nav.indexOf('id: "exportar"'), nav.indexOf('id: "plan"'));
    expect(item).toContain("/dashboard/administracion/exportar");
    // Sin `module`: condicionarlo a una capacidad del plan es justo lo que no
    // puede pasar con los datos propios del cliente.
    expect(item).not.toContain("module:");
  });

  it("lo exportado se puede volver a importar: mismos formatos", () => {
    // La propiedad que hace posible el ciclo exportar → corregir en Excel →
    // reimportar. La prueba del círculo completo vive en export.test.ts; aquí se
    // vigila que nadie rompa el acoplamiento deliberado entre los dos módulos.
    const exportLib = read("src/lib/export.ts");
    expect(exportLib).toContain('from "@/lib/import"');
    expect(exportLib).toMatch(/IMPORT_TARGETS/);
  });
});

describe("RR. HH.: que lo que se teclea sirva para algo", () => {
  /**
   * Tres campos llevaban desde 0009 pidiéndose y sin que nadie los leyera:
   * `blocks_assignment`, el `status` de la certificación y `hours_worked`.
   * Lo que los devuelve a ese estado no es borrar código —es que un refactor
   * se lleve por delante el enganche y nadie lo note, porque un bloqueo que no
   * se comprueba no rompe ninguna prueba de la UI—.
   */

  it("la API genérica comprueba la certificación al CREAR y al EDITAR", () => {
    // Solo al crear no basta: bastaría con crear el turno vacío y asignarle
    // después la persona para saltarse el bloqueo entero.
    for (const file of [
      "src/app/api/erp/[resource]/route.ts",
      "src/app/api/erp/[resource]/[id]/route.ts",
    ]) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      // `sellado` en la creación: es el mismo payload con el vendedor de quien
      // crea ya puesto (`sellerStampFor`). Lo que importa es que se compruebe
      // LO QUE SE VA A ESCRIBIR, no una copia anterior.
      expect(src, file).toMatch(/await assertPayloadAssignable\(ctx\.companyId, def\.table, (payload|sellado)\)/);
    }
  });

  it("la comprobación va ANTES de escribir, no después", () => {
    for (const [file, escritura] of [
      ["src/app/api/erp/[resource]/route.ts", "await tenantCreate(ctx.companyId, def.table, sellado)"],
      ["src/app/api/erp/[resource]/[id]/route.ts", "await tenantUpdate(ctx.companyId, def.table, id, payload)"],
    ] as const) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src.indexOf("assertPayloadAssignable"), file).toBeLessThan(src.indexOf(escritura));
    }
  });

  it("publicar el cuadrante comprueba solape Y certificación", () => {
    const src = read("src/app/api/shifts/publish/route.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/await assertStaffAssignable\(/);
    expect(src).toMatch(/await findShiftConflict\(/);
    expect(src).toMatch(/publishDecision\(/);
  });

  it("lo que impide pagar dos veces NO es escribible por formulario", () => {
    // `payroll_run_id` es el enlace que reclama un marcaje, y `approved_at`
    // quién dio el visto bueno. Escribibles, bastaría con ponerlos a null para
    // volver a cobrar una quincena ya pagada.
    const resources = read("src/lib/resources.ts");
    const bloque = /^ {2}attendance:\s*\{\n([\s\S]*?)^ {2}\},/m.exec(resources)?.[1] ?? "";
    expect(bloque).not.toMatch(/"payroll_run_id"/);
    expect(bloque).not.toMatch(/"approved_at"/);
  });

  it("la nómina no se teclea: las líneas son de solo lectura y los importes de la corrida tampoco entran", () => {
    const resources = read("src/lib/resources.ts");
    const linea = /^ {2}payroll_line:\s*\{\n([\s\S]*?)^ {2}\},/m.exec(resources)?.[1] ?? "";
    expect(linea).toMatch(/writable:\s*\[\]/);

    const corrida = /^ {2}payroll_run:\s*\{\n([\s\S]*?)^ {2}\},/m.exec(resources)?.[1] ?? "";
    for (const campo of ["gross_amount", "net_amount", "deductions_amount", "employer_cost", "status"]) {
      expect(corrida, campo).not.toMatch(new RegExp(`"${campo}"`));
    }
  });

  it("los sueldos no los lee cualquiera del inquilino", () => {
    // Es el dato más sensible que guarda una empresa pequeña: lo que cobra cada
    // compañero. Sin esto, `/api/erp/payroll_line` estaba abierto a todos.
    const resources = read("src/lib/resources.ts");
    const mapa = /const READ_ROLE[\s\S]*?\n\};/.exec(resources)?.[0] ?? "";
    expect(mapa).toMatch(/payroll_run:\s*"admin"/);
    expect(mapa).toMatch(/payroll_line:\s*"admin"/);
  });

  it("el barrido de certificaciones está programado, no solo escrito", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.map((c) => c.path)).toContain("/api/cron/certifications");
  });

  it("el barrido no vuelve a avisar todos los días de lo mismo", () => {
    const src = read("src/app/api/cron/certifications/route.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/reminder_sent_at/);
    expect(src).toMatch(/REMINDER_COOLDOWN_DAYS/);
  });

  it("el barrido no pisa lo que decidió una persona", () => {
    // Revocada y pendiente son decisiones administrativas: el calendario no
    // puede devolverlas a «vigente» ni a «por vencer».
    const src = read("src/app/api/cron/certifications/route.ts");
    expect(src).toMatch(/\(revoked,pending\)/);
  });

  it("exportar la nómina sale de lo guardado, no de un recálculo", () => {
    // Lo que se exporta tiene que ser lo que se aprobó: recalcular al exportar
    // haría que el archivo cambiara si alguien tocó un marcaje después.
    const src = read("src/app/api/payroll/[id]/export/route.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/await linesOf\(ctx\.companyId, id\)/);
    expect(src).not.toMatch(/generatePayrollRun/);
  });

  it("la pantalla de certificaciones pinta el estado DEDUCIDO, no la columna", () => {
    const page = read("src/app/dashboard/equipo/certificaciones/page.tsx");
    // Se mira LA COLUMNA DE ESTADO, no el archivo entero: `certificationState`
    // aparece también al pintar la fecha, así que buscarlo en cualquier sitio
    // daría por buena una insignia que volviera a leer `c.status`.
    const inicio = page.indexOf('key: "status"');
    expect(inicio, "no se encontró la columna de estado").toBeGreaterThan(-1);
    const columna = page.slice(inicio, page.indexOf("},", inicio));
    expect(columna).toMatch(/certificationState\(c, hoy\(\)\)/);
    expect(columna).not.toMatch(/value=\{c\.status\}/);
    expect(columna).not.toMatch(/kind: "badge"/);
  });

  it("la asistencia dejó de pedir las horas a mano en el formulario de alta", () => {
    // Era un campo «Horas trabajadas» teniendo la entrada y la salida al lado.
    const page = read("src/app/dashboard/equipo/asistencia/page.tsx");
    expect(page).not.toMatch(/name: "hours_worked"/);
    expect(page).toMatch(/\/api\/attendance\/clock/);
  });
});

describe("inventario: que comprar y vender muevan el almacén", () => {
  /**
   * El motor de inventario (0013) siempre estuvo bien; lo que faltaba era quién
   * lo llamaba. Recibir una compra no movía una unidad y vender tampoco, así
   * que lo comprado, lo vendido y lo que hay en el estante eran tres cifras que
   * solo se encontraban en el conteo físico de fin de mes.
   */

  it("recibir una orden de compra mueve stock de verdad", () => {
    const src = read("src/lib/purchasing-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/await postMovement\(companyId, \{/);
    expect(src).toMatch(/movement_type: "receipt"/);
    // Y queda atado a SU línea: sin eso, lo recibido solo vive en una columna
    // que se puede teclear.
    expect(src).toMatch(/purchase_order_line: linea\.lineId/);
  });

  it("el movimiento se escribe ANTES de dar la línea por recibida", () => {
    // Al revés, una caída a medias deja la orden diciendo «recibida» con el
    // almacén vacío, y eso no se detecta hasta el conteo físico.
    const src = read("src/lib/purchasing-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src.indexOf("await postMovement")).toBeLessThan(src.indexOf('"purchase_order_line", linea.lineId'));
  });

  it("lo recibido se cuenta por los movimientos, no por la columna", () => {
    const src = read("src/lib/purchasing-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/export async function receivedByLine/);
    expect(src).toMatch(/"stock_movement"/);
    // Y una devolución al proveedor resta: contar solo entradas daría la orden
    // por cerrada con mercancía que ya no está.
    expect(src).toMatch(/movement_type === "return" \? -1 : 1/);
  });

  it("el saldo de existencias NO se puede escribir desde el CRUD genérico", () => {
    // `inventory.ts` abre prometiendo que nada más lo escribe directamente, y el
    // CRUD lo tenía entero como escribible: editarlo ahí lo separa del libro de
    // movimientos que es su única explicación.
    const resources = read("src/lib/resources.ts");
    const bloque = /^ {2}stock_level:\s*\{\n([\s\S]*?)^ {2}\},/m.exec(resources)?.[1] ?? "";
    expect(bloque).toMatch(/writable:\s*\[\]/);
  });

  it("lo recibido de una línea de compra tampoco se teclea", () => {
    const resources = read("src/lib/resources.ts");
    const bloque = /^ {2}purchase_order_line:\s*\{\n([\s\S]*?)^ {2}\},/m.exec(resources)?.[1] ?? "";
    const writable = /writable:\s*\[([^\]]*)\]/.exec(bloque)?.[1] ?? "";
    expect(writable).not.toMatch(/"quantity_received"/);
  });

  it("vender aparta existencias sin escribir un movimiento", () => {
    // La mercancía no ha salido: escribir un movimiento al vender llenaría el
    // libro de salidas que nunca ocurrieron.
    const src = read("src/lib/stock-commitment-service.ts");
    const reservar = src.slice(
      src.indexOf("export async function reserveForSale"),
      src.indexOf("export interface SettleResult")
    );
    expect(reservar).toMatch(/stock_state: "reserved"/);
    expect(reservar).not.toMatch(/postMovement/);
  });

  it("los tres momentos del ciclo están enganchados donde ocurren", () => {
    const venta = read("src/lib/booking-service.ts");
    expect(venta).toMatch(/reserveForSale\(/);

    const embarque = read("src/app/api/bookings/[id]/checkin/route.ts");
    expect(embarque).toMatch(/settleBookingStock\(ctx\.companyId, id, "consume"/);

    const cancelacion = read("src/lib/booking-cancel-service.ts");
    expect(cancelacion).toMatch(/settleBookingStock\(ctx\.companyId, id, "release"/);
  });

  it("el almacén nunca tumba una venta ni un embarque", () => {
    // Un ERP que no deja vender porque un extra está mal configurado es un ERP
    // que se desinstala. Los tres enganches van dentro de un try.
    for (const [file, llamada] of [
      ["src/lib/booking-service.ts", "reserveForSale("],
      ["src/app/api/bookings/[id]/checkin/route.ts", "settleBookingStock("],
      ["src/lib/booking-cancel-service.ts", "settleBookingStock("],
    ] as const) {
      const src = read(file);
      const at = src.indexOf(llamada);
      expect(at, file).toBeGreaterThan(-1);
      // El `try {` más cercano por delante tiene que estar dentro de un margen
      // corto: el enganche está envuelto, no suelto en medio de la saga.
      const antes = src.slice(Math.max(0, at - 700), at);
      expect(antes, file).toMatch(/try \{/);
    }
  });

  it("el extra solo consume almacén si alguien lo enciende a propósito", () => {
    // Nace en false: una recogida en el hotel no sale de ningún estante, y
    // deducirlo sería descontar cosas que no existen.
    const sql = read("supabase/migrations/0052_receipts_and_stock.sql");
    expect(sql).toMatch(/consumes_stock boolean not null default false/);
  });

  it("la pantalla de extras deja configurar de dónde salen", () => {
    const page = read("src/app/dashboard/catalogo/extras/page.tsx");
    for (const campo of ["consumes_stock", "inventory_item", "warehouse", "stock_per_unit"]) {
      expect(page, campo).toMatch(new RegExp(`name: "${campo}"`));
    }
  });
});

describe("contabilidad: el mes cerrado se cierra de verdad", () => {
  /**
   * El mayor aceptaba cualquier asiento con cualquier fecha. El 607 se envía el
   * día 20 y nada impedía contabilizar con fecha del mes anterior: lo declarado
   * y los libros empezaban a decir cosas distintas, y la diferencia solo
   * aparecía cuando la DGII cruzaba los comprobantes.
   */

  it("el mayor comprueba el periodo ANTES de escribir la primera línea", () => {
    // Un asiento a medias en un mes cerrado sería peor que el problema que esto
    // evita.
    const src = read("src/lib/ledger.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const guarda = src.indexOf("postingBlocker(period, periods)");
    const escritura = src.indexOf('await tenantCreate<{ _id: string }>(companyId, "ledger_entry"');
    expect(guarda).toBeGreaterThan(-1);
    expect(escritura).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(escritura);
  });

  it("el periodo contable NO se puede escribir desde el CRUD genérico", () => {
    // Bastaría con poner el estado en «abierto» para contabilizar dentro de un
    // mes ya enviado a la DGII.
    const resources = read("src/lib/resources.ts");
    const bloque = /^ {2}accounting_period:\s*\{\n([\s\S]*?)^ {2}\},/m.exec(resources)?.[1] ?? "";
    expect(bloque).toMatch(/writable:\s*\[\]/);
  });

  it("el balance de comprobación pagina en vez de truncar en silencio", () => {
    // Pedía 5 000 asientos y se quedaba con lo que viniera: a partir de ahí el
    // informe que existe para demostrar que los libros cuadran devolvía cifras
    // incompletas y decía «cuadrado» igual.
    const src = read("src/lib/ledger.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const fn = src.slice(src.indexOf("export async function trialBalance"));
    expect(fn).toMatch(/_offset: offset/);
    expect(fn).toMatch(/if \(page\.length < TRIAL_PAGE\) break;/);
    // Y dice sobre cuántos asientos se calculó.
    expect(fn).toMatch(/entries: entries\.length/);
  });

  it("el cierre del ejercicio es un ASIENTO, no una bandera", () => {
    // Una bandera obligaría a cada informe a recordar excluir el año anterior.
    const src = read("src/lib/financials-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/const lines = closingEntry\(/);
    expect(src).toMatch(/await post\(companyId, \{/);
    expect(src).toMatch(/RETAINED_EARNINGS|closingEntry/);
  });

  it("el ejercicio no se cierra dos veces", () => {
    const src = read("src/lib/financials-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const fn = src.slice(src.indexOf("export async function closeYear"));
    expect(fn).toMatch(/is_closing: true/);
    expect(fn).toMatch(/ya está cerrado/);
    expect(fn.indexOf("ya está cerrado")).toBeLessThan(fn.indexOf("await post("));
  });

  it("los estados financieros y las declaraciones son LECTURA", () => {
    // Una empresa con la suscripción vencida sigue teniendo que declarar sus
    // impuestos y cerrar su contabilidad.
    for (const file of [
      "src/app/api/ledger/statements/route.ts",
      "src/app/api/reports/dgii/route.ts",
    ]) {
      const src = read(file);
      const get = src.slice(src.indexOf("export async function GET"));
      expect(get, file).toMatch(/await requireTenant\(\)/);
      expect(get, file).not.toMatch(/await requireTenantWrite\(\)/);
    }
  });

  it("el 608 está en el catálogo, en el servicio y en la pantalla", () => {
    // Es el tercero de la terna y el que más se olvida: la DGII cruza los NCF
    // emitidos con los anulados.
    expect(read("src/lib/dgii.ts")).toMatch(/export function line608\(/);
    // Se comprueba la LLAMADA, no el nombre: una función `load608` que nadie
    // invoca deja la declaración vacía igual que si no existiera.
    const servicio = read("src/lib/dgii-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(servicio).toMatch(/kind === "608" \? await load608\(ctx, month\)/);
    expect(servicio).toMatch(/async function load608\(ctx/);
    expect(read("src/app/api/reports/dgii/route.ts")).toMatch(/"606", "607", "608"/);
    expect(read("src/app/dashboard/finanzas/declaraciones/page.tsx")).toMatch(/608 · Anulaciones/);
  });

  it("anular una factura guarda el código que el 608 exige", () => {
    const src = read("src/lib/invoice-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/void_reason_code:/);
    // Lo que no esté en la lista del formato cae en el código por defecto: un
    // código inventado hace que la DGII rechace el archivo entero.
    expect(src).toMatch(/VOID_REASONS\[String\(reasonCode \|\| ""\)\]/);
  });
});

describe("distribución: el cupo del socio acota de verdad", () => {
  /**
   * `allotment` existía desde la migración 0010 con plazas, plazas usadas y
   * días de liberación, y nadie la leía: se le prometían 10 plazas a una
   * agencia por contrato y el sistema le dejaba vender las 40 de la salida, o
   * ninguna. El cupo se llevaba en un Excel.
   */

  it("la venta comprueba el cupo, y solo cuando hay socio", () => {
    // Sin socio no hay contrato que aplicar: el vendedor de la casa vende
    // contra la capacidad, que es lo que debe ser.
    const src = read("src/lib/booking-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/await assertAllotment\(/);
    // Se mira el tramo entre el mapa del cupo y la comprobación, no una ventana
    // de N caracteres: cualquier línea que se añada en medio movería la ventana
    // y la guarda dejaría de mirar lo que dice mirar.
    const desde = src.indexOf("const allotmentUse");
    const hasta = src.indexOf("await assertAllotment(");
    expect(desde).toBeGreaterThan(-1);
    expect(desde).toBeLessThan(hasta);
    expect(src.slice(desde, hasta)).toMatch(/if \(input\.partner_id\)/);
  });

  it("la capacidad se comprueba ANTES que el cupo", () => {
    // La capacidad es un límite físico —no caben— y el cupo es un contrato. Si
    // no caben, el motivo que hay que dar es ese.
    const src = read("src/lib/booking-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src.indexOf("await assertCapacity(")).toBeLessThan(src.indexOf("await assertAllotment("));
  });

  it("el consumo se apunta DESPUÉS de que la venta exista", () => {
    // Apuntarlo antes y que la saga se compensara dejaría el cupo consumido por
    // una venta que no llegó a haber.
    const src = read("src/lib/booking-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src.indexOf("await consumeAllotment(")).toBeGreaterThan(src.indexOf("const aviso"));
    expect(src.indexOf("await consumeAllotment(")).toBeLessThan(src.lastIndexOf("return { order:"));
  });

  it("cancelar devuelve las plazas a SU cupo", () => {
    const src = read("src/lib/booking-cancel-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/await releaseBookingAllotment\(/);
    // Por las plazas que la reserva GUARDÓ, no por las que diga el cupo hoy.
    expect(src).toMatch(/allotment_seats/);
  });

  it("la reserva guarda de qué cupo salió, y del suyo", () => {
    /**
     * ────────────────────────────────────────────────────────────────────────
     * ESTA GUARDA VIGILABA LA IMPLEMENTACIÓN Y SE VOLVIÓ EN CONTRA
     *
     * Antes exigía el texto literal `allotment: used[0], allotment_seats: pax`.
     * Eso fijaba UNA forma de escribirlo, no la regla — y la forma que fijaba
     * tenía dentro un error: `used[0]` salía de un respaldo que, cuando el
     * producto no tenía cupo propio, cogía el primer cupo de la lista y le
     * cargaba las plazas al contrato de otro producto. La guarda protegía el
     * error.
     *
     * Ahora exige lo que de verdad importa: que el cupo de cada línea se
     * guarde mientras se sabe, en vez de reconstruirse después adivinando. El
     * comportamiento se comprueba de verdad en `booking-service.test.ts`, que
     * vende Saona (con contrato) y Buggy (sin él) en el mismo carrito.
     */
    const src = read("src/lib/booking-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src, "el cupo de cada línea se guarda cuando se resuelve").toMatch(/allotmentOfItem\.set\(item,/);
    expect(src, "y se lee de ahí, sin adivinar").toMatch(/allotmentOfItem\.get\(item\)/);
    expect(src, "nada de coger «el primero de la lista» como respaldo")
      .not.toMatch(/\[\.\.\.allotmentUse\.entries\(\)\]\[0\]/);
  });

  it("la liberación automática está programada, no solo escrita", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.map((c) => c.path)).toContain("/api/cron/allotments");
  });

  it("el barrido solo toca cupos garantizados con salida y con días de liberación", () => {
    // Un cupo de producto sin salida no tiene fecha contra la que contar, y
    // liberarlo «por si acaso» le quitaría plazas a un contrato vigente.
    const src = read("src/app/api/cron/allotments/route.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/\.eq\("allotment_type", "guaranteed"\)/);
    expect(src).toMatch(/\.not\("release_days", "is", null\)/);
    expect(src).toMatch(/\.not\("departure_id", "is", null\)/);
  });

  it("el barrido acumula lo liberado en vez de reescribirlo", () => {
    // Sin acumular, un reintento del cron devolvería a venta libre plazas que
    // ya estaban en venta libre, y la salida aceptaría más de las que caben.
    const src = read("src/app/api/cron/allotments/route.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/seats_released: Math\.max\(0, Math\.floor\(Number\(row\.seats_released \?\? 0\)\)\) \+ seats/);
  });

  it("lo liberado deja de contar como disponible para el socio", () => {
    // Contarlo prometería dos veces la misma plaza: una al socio y otra a quien
    // la compró después.
    const src = read("src/lib/allotments.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/remaining: holds \? Math\.max\(0, seats - used - released\)/);
  });
});

describe("la marca: que los documentos sean de la empresa, no nuestros", () => {
  /**
   * La pantalla de Configuración pedía WhatsApp, logo, dirección y color desde
   * el principio, `/api/company` los declaraba editables y el tipo `Company` los
   * declaraba — y ninguna de esas columnas existía. PostgREST rechaza el UPDATE
   * ENTERO cuando una sola columna del payload no existe, así que escribir un
   * WhatsApp hacía perder también el nombre y el RNC del mismo formulario.
   */

  it("el acento del PDF sale del color de marca, no de una constante", () => {
    // Era `rgb(0.05, 0.42, 0.42)` quemado: todas las empresas entregaban
    // documentos del mismo verde.
    const src = read("src/lib/pdf/doc.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/const accentOf = \(brand\?: DocumentBrand \| null\)/);
    expect(src).toMatch(/accent = accentOf\(meta\.brand\)/);
    // Y ya no queda ninguna constante de acento suelta.
    expect(src).not.toMatch(/^const ACCENT\b/m);
  });

  it("los seis documentos llevan la marca, no solo algunos", () => {
    /**
     * Seis builders y seis llamantes: bastaba con que uno se olvidara para que
     * ESE documento saliera del color de casa sin que nadie supiera por qué.
     *
     * El voucher pasa una marca distinta desde la Fase 5 —la del tour center
     * que vendió—, así que se cuenta `brandFor(` y no `brandFor(company,`. Lo
     * que la regla persigue es que ninguno se quede SIN marca, y eso se sigue
     * midiendo igual; la de abajo comprueba que ese caso es el del socio y no
     * una marca cualquiera.
     */
    const src = read("src/lib/pdf/documents.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const creates = src.match(/await PdfBuilder\.create\(\{/g) ?? [];
    const brands = src.match(/await brandFor\(/g) ?? [];
    expect(creates.length).toBeGreaterThanOrEqual(6);
    expect(brands.length).toBe(creates.length);
    // Y solo uno puede apartarse de la marca de la empresa.
    expect((src.match(/await brandFor\(company, "/g) ?? []).length).toBe(creates.length - 1);
    expect(src).toMatch(/await brandFor\(data\.brand_override \?\? company, "voucher"\)/);
  });

  it("bajar el logo nunca puede dejar sin documento", () => {
    // Generar un voucher ocurre delante de un cliente: un almacenamiento lento
    // o un enlace roto no pueden dejarle sin papel.
    const src = read("src/lib/pdf/logo.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/catch \(err\)/);
    expect(src).toMatch(/return null;/);
    expect(src).toMatch(/AbortController/);
    expect(src).toMatch(/MAX_LOGO_BYTES/);
  });

  it("el logo se incrusta una sola vez aunque el documento tenga varias hojas", () => {
    const src = read("src/lib/pdf/doc.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // Se incrusta en `create`, no en `drawPageHeader`, que corre por hoja.
    const header = src.slice(src.indexOf("private drawPageHeader"), src.indexOf("rule(): void"));
    expect(header).not.toMatch(/embedPng|embedJpg/);
    expect(src).toMatch(/builder\.logoImage =/);
  });

  it("solo llega al PDF un formato que el PDF sabe incrustar", () => {
    // Un SVG se ve en pantalla y NO sale en el voucher: la empresa se enteraría
    // por un cliente.
    const subida = read("src/app/api/company/logo/route.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(subida).toMatch(/PDF_IMAGE_TYPES\.has\(file\.type\)/);
    expect(read("src/lib/branding.ts")).toMatch(/PDF_IMAGE_TYPES = new Set\(\["image\/png", "image\/jpeg"\]\)/);
  });

  it("el color se valida antes de guardarse, no al pintarlo", () => {
    // La base tiene un check que rechaza cualquier otra cosa: dejar pasar un
    // "azul" del formulario convertiría un error de tecleo en un 500 sin
    // explicación.
    const src = read("src/app/api/company/route.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/normalizeColor\(dbPatch\.brand_color\)/);
    const sql = read("supabase/migrations/0055_company_branding.sql");
    expect(sql).toMatch(/brand_color ~ '\^#\[0-9a-f\]\{6\}\$'/);
  });

  it("la página pública valida el color en vez de fiarse de un respaldo", () => {
    const src = read("src/app/reservar/[slug]/_components/booking-engine.tsx")
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/brandColor\(org\.brandColor\)/);
    expect(src).not.toMatch(/org\.brandColor \|\|/);
  });

  it("las condiciones del voucher y la nota legal de la factura se imprimen", () => {
    const src = read("src/lib/pdf/documents.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // Desde la ola 6 la etiqueta va en el idioma del huésped: lo que se ata es
    // que las condiciones de la empresa SIGUEN imprimiéndose en el voucher.
    expect(src).toMatch(/pdf\.block\(t\("doc\.terms"\), brand\.terms\)/);
    expect(src).toMatch(/pdf\.block\("Nota legal", brand\.terms\)/);
  });
});

describe("conector OCTO: que una OTA venda sin romper nada por dentro", () => {
  /**
   * ────────────────────────────────────────────────────────────────────────
   * QUÉ PROTEGEN ESTAS GUARDAS
   *
   * El riesgo de un conector no es que no funcione: es que funcione a medias y
   * nadie se entere. Una reserva de OTA que se escribe directamente contra la
   * tabla «se ve bien» —aparece en la lista, tiene número, tiene importe— y no
   * comprueba el cupo, no consume el contrato del socio, no devenga la
   * comisión, no aparta el almuerzo, no genera voucher y no sale en el
   * manifiesto. Se descubre en el punto de encuentro.
   *
   * Por eso lo que se ata aquí es que las reservas de OTA pasen por EL MISMO
   * camino que las del mostrador, y que las exenciones de CSRF y de plan estén
   * compensadas por comprobaciones equivalentes.
   */

  const octoRoutes = () =>
    walk(path.join(ROOT, "src/app/api/octo/v1"))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"));

  const sinComentarios = (file: string) =>
    read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("toda ruta del conector autentica con llave, y la que escribe con alcance de escritura", () => {
    // Esto es lo que EARNA la exención del blindaje CSRF: no hay cookies que
    // proteger porque no hay sesión, pero sí hay una llave que comprobar. Una
    // ruta del conector sin `octoRequest` sería pública de verdad.
    const sinLlave: string[] = [];
    const escrituraSinAlcance: string[] = [];
    for (const rel of octoRoutes()) {
      const src = sinComentarios(rel);
      if (!/await octoRequest\(req, "(read|write)"\)/.test(src)) sinLlave.push(rel);
      const muta = /export async function (POST|PUT|PATCH|DELETE)\(/.test(src);
      if (muta && !/await octoRequest\(req, "write"\)/.test(src)) escrituraSinAlcance.push(rel);
    }
    expect(sinLlave, "rutas OCTO sin autenticar").toEqual([]);
    // La disponibilidad es POST por el estándar y es una LECTURA: se exceptúa
    // por nombre, no por descuido.
    expect(
      escrituraSinAlcance.filter((rel) => !rel.includes("/availability/")),
      "rutas OCTO que mutan con llave de solo lectura"
    ).toEqual([]);
  });

  it("vender por el conector exige que la suscripción lo permita", () => {
    // Esto es lo que EARNA la exención del contrato del plan. Sin ella, una
    // operadora con la cuenta vencida seguiría recibiendo reservas de OTA que
    // después no podría operar.
    for (const rel of ["src/app/api/octo/v1/bookings/route.ts",
                       "src/app/api/octo/v1/bookings/[uuid]/confirm/route.ts"]) {
      expect(sinComentarios(rel), rel).toMatch(/assertCanSell\(ctx\)/);
    }
  });

  it("la reserva de una OTA pasa por el motor de ventas, no por un atajo", () => {
    // Un insert a mano en `booking` es diez líneas y deja media operación
    // mintiendo: sin cupo comprobado, sin comisión, sin voucher, sin manifiesto.
    const src = sinComentarios("src/lib/octo-service.ts");
    expect(src).toMatch(/await createOrderWithBookings\(saleCtx, \{/);
    // Y no hay ninguna creación directa de la reserva por fuera del motor.
    expect(src).not.toMatch(/from\("booking"\)\s*\.insert/);
    expect(src).not.toMatch(/tenantCreate\([^,]+,\s*"booking"/);
  });

  it("cancelar desde una OTA hace exactamente lo mismo que cancelar de mostrador", () => {
    const src = sinComentarios("src/lib/octo-service.ts");
    expect(src).toMatch(/await cancelBookingFully\(cancelCtx, booking\[0\] as never, \{/);
  });

  it("el `force` del estándar no decide el reembolso", () => {
    // OCTO admite que el revendedor pida saltarse el corte de cancelación.
    // Obedecerlo sería dejar que decida desde su servidor cuánto se le
    // devuelve, que es el acuerdo comercial de la operadora.
    const src = sinComentarios("src/app/api/octo/v1/bookings/[uuid]/cancel/route.ts");
    expect(src).not.toMatch(/body\.force/);
    const servicio = sinComentarios("src/lib/octo-service.ts");
    expect(servicio).not.toMatch(/refundOverride/);
  });

  it("un revendedor no puede leer las reservas de otro", () => {
    // Sin el filtro por socio bastaría con adivinar un uuid para ver el nombre
    // y el teléfono del cliente de la competencia.
    const src = sinComentarios("src/lib/octo-service.ts");
    const inicio = src.indexOf("async function loadRow(");
    expect(inicio).toBeGreaterThan(-1);
    const cuerpo = src.slice(inicio, src.indexOf("}", src.indexOf('.eq("octo_uuid", uuid)')) + 1);
    expect(cuerpo).toMatch(/if \(ctx\.partnerId\) query = query\.eq\("partner_id", ctx\.partnerId\)/);
    // Y el listado tiene el mismo filtro: sin él, la búsqueda por referencia
    // sería la puerta de atrás del mismo dato.
    const listado = src.slice(src.indexOf("export async function listBookings("));
    expect(listado.slice(0, listado.indexOf("const { data }")))
      .toMatch(/if \(ctx\.partnerId\) query = query\.eq\("partner_id", ctx\.partnerId\)/);
  });

  it("antes de contar plazas se sueltan las retenciones vencidas", () => {
    // Una retención de OTA dura minutos y el barrido general corre una vez al
    // día: sin esto se contesta SOLD_OUT por un carrito abandonado por la
    // mañana, y la venta se pierde.
    const src = sinComentarios("src/lib/octo-service.ts");
    for (const fn of ["octoAvailability", "octoCalendar", "reserve"]) {
      const at = src.indexOf(`export async function ${fn}(`);
      expect(at, fn).toBeGreaterThan(-1);
      const cabeza = src.slice(at, at + 600);
      expect(cabeza, `${fn} no barre las retenciones vencidas`)
        .toMatch(/await sweepExpiredOctoHolds\(ctx\.companyId\)/);
    }
    // Y se MARCA vencida antes de cancelarla: al revés, el revendedor leería
    // CANCELLED —una incidencia que atender— en vez de EXPIRED, que es suya.
    const barrido = src.slice(src.indexOf("export async function sweepExpiredOctoHolds("));
    expect(barrido.indexOf('octo_status: "EXPIRED"'))
      .toBeLessThan(barrido.indexOf("await releaseExpiredHolds("));
  });

  it("el precio y la moneda no vienen del revendedor", () => {
    // Una llave de API es una contraseña que vende en nombre de la operadora;
    // si además dejara poner el precio, sería una que regala su margen.
    const dominio = sinComentarios("src/lib/octo.ts");
    const lectura = dominio.slice(dominio.indexOf("export function readReservation("));
    const cuerpo = lectura.slice(0, lectura.indexOf("\n}\n"));
    expect(cuerpo).not.toMatch(/body\.pricing/);
    expect(cuerpo).not.toMatch(/body\.currency/);
    expect(cuerpo).not.toMatch(/body\.unitPrice/);
  });

  it("los estados del estándar son los mismos en el dominio y en la base", () => {
    // Escribir un estado que OCTO no define sería inventarse una palabra que el
    // revendedor no sabe interpretar, y se descubriría en producción.
    const dominio = read("src/lib/octo.ts");
    const union = /export type OctoBookingStatus =([\s\S]*?);/.exec(dominio)?.[1] ?? "";
    const enDominio = [...union.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort();
    const sql = read("supabase/migrations/0056_octo_connector.sql");
    const check = /octo_status in \(([\s\S]*?)\)/.exec(sql)?.[1] ?? "";
    const enBase = [...check.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(enBase, "los estados de la migración no coinciden con los del dominio").toEqual(enDominio);
  });

  it("la pantalla de canales es una lectura y no la bloquea una suscripción vencida", () => {
    // Mirar lo que ya se vendió tiene que seguir funcionando justo cuando la
    // cuenta está vencida, que es cuando más falta hace.
    const src = sinComentarios("src/app/api/octo/channels/route.ts");
    expect(src).toMatch(/await requireTenant\(\)/);
    expect(src).not.toMatch(/requireTenantWrite/);
  });

  it("las retenciones vencidas se marcan ANTES de cancelarse, también en el repaso diario", () => {
    /**
     * Esta guarda nació pidiendo un cron horario propio y la realidad la
     * corrigió: el plan Hobby de Vercel solo admite trabajos diarios, así que
     * ese cron NO DESPLEGABA. La lección no fue «hace falta el plan Pro», sino
     * que la frecuencia del cron nunca era lo que sostenía esto.
     *
     * Lo que lo sostiene es el barrido al consultar disponibilidad y al
     * reservar —ya atado en la guarda de arriba—, porque una plaza bloqueada de
     * más solo hace daño cuando alguien intenta comprarla, y ese intento es lo
     * que dispara el barrido.
     *
     * Lo que se ata aquí es el repaso diario y, sobre todo, su ORDEN.
     */
    const cron = sinComentarios("src/app/api/cron/collections/route.ts");
    expect(cron).toMatch(/await markExpiredOctoHolds\(companyId, now\)/);
    // Marcar ANTES de cancelar: al revés, el revendedor lee CANCELLED —una
    // incidencia con reembolso que decidir— en vez de EXPIRED, que es suya.
    expect(cron.indexOf("await markExpiredOctoHolds("))
      .toBeLessThan(cron.indexOf("await releaseExpiredHolds("));
    expect(cron).toMatch(/process\.env\.CRON_SECRET/);

    // Y ningún trabajo programado puede ser más frecuente que diario: el plan
    // no lo admite y el despliegue entero falla, no solo ese cron.
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const subDiarios = vercel.crons.filter((c) => !/^\S+ \d+ \* \* \*$/.test(c.schedule));
    expect(subDiarios.map((c) => `${c.path} (${c.schedule})`), "crons más frecuentes que diarios").toEqual([]);
  });

  it("solo se anuncian las capacidades que se cumplen", () => {
    // Anunciar una que no se cumple hace que el revendedor deje de mandar los
    // campos que compensaban su ausencia, y todo falla más tarde y peor.
    const dominio = read("src/lib/octo.ts");
    const lista = /export const SUPPORTED_CAPABILITIES: OctoCapability\[\] = \[([\s\S]*?)\];/.exec(dominio)?.[1] ?? "";
    const anunciadas = [...lista.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(anunciadas.length).toBeGreaterThan(0);
    // Cada una tiene que estar REALMENTE consultada en el código, no solo
    // declarada.
    const usadas = read("src/lib/octo.ts") + read("src/lib/octo-service.ts");
    for (const cap of anunciadas) {
      expect(usadas, `se anuncia ${cap} y no se usa en ninguna parte`).toContain(`"${cap}"`);
    }
  });
});

describe("canje de beneficios MembeGo: que el descuento lo respalde alguien", () => {
  /**
   * ────────────────────────────────────────────────────────────────────────
   * LA REGLA QUE ESTAS GUARDAS SOSTIENEN
   *
   * La migración 0041 dejó escrito, hace dos olas, por qué la elegibilidad no
   * se copia: «decide dinero y una copia desfasada regala un beneficio ya
   * consumido». El canje es justo el punto donde esa regla se rompe sola si
   * alguien busca un atajo — una tabla local de «beneficios del cliente», una
   * caché de cinco minutos, rebajar primero y consumir después.
   *
   * Lo que se ata aquí es el orden y la ausencia de caché, que son las dos
   * formas concretas de regalar dinero.
   */

  const sinComentarios = (file: string) =>
    read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("primero se consume en MembeGo y DESPUÉS se rebaja la venta", () => {
    // Al revés, un beneficio gastado hace diez minutos en otra sucursal dejaría
    // la venta rebajada sin nada que la respalde.
    const src = sinComentarios("src/lib/membego-redemption-service.ts");
    const canje = src.indexOf("await redeemMembership(");
    const rebaja = src.indexOf('await tenantUpdate(companyId, "booking", chosen.id, {');
    expect(canje, "no se consume en MembeGo").toBeGreaterThan(-1);
    expect(rebaja, "no se rebaja la línea").toBeGreaterThan(-1);
    expect(canje, "la venta se rebaja antes de consumir el beneficio").toBeLessThan(rebaja);
  });

  it("la elegibilidad no se guarda en ninguna parte", () => {
    // Ni en la base ni en memoria. Lo único que se cachea es el token, que no
    // es un dato de negocio.
    const servicio = sinComentarios("src/lib/membego-redemption-service.ts");
    expect(servicio).not.toMatch(/from\("membego_customer"\)[\s\S]{0,200}eligib/i);
    const cliente = sinComentarios("src/lib/membego-platform.ts");
    // El único cacheo del cliente es el token.
    const cacheos = [...cliente.matchAll(/cached\s*=/g)].length;
    expect(cacheos, "hay más de una cosa cacheada además del token").toBeLessThanOrEqual(2);
    expect(cliente).toMatch(/interface CachedToken/);
  });

  it("cada canje viaja con una clave de idempotencia derivada, no aleatoria", () => {
    // El doble clic del cajero tiene que encontrarse con el primer canje, no
    // consumir un segundo uso.
    const dominio = sinComentarios("src/lib/membego-benefits.ts");
    expect(dominio).toMatch(/return `pt:\$\{orderId\}:\$\{benefitId\}`/);
    const cliente = sinComentarios("src/lib/membego-platform.ts");
    expect(cliente).toMatch(/"Idempotency-Key": options\.idempotencyKey/);
    const servicio = sinComentarios("src/lib/membego-redemption-service.ts");
    expect(servicio).toMatch(/idempotencyKeyFor\(input\.orderId, input\.benefit\.id\)/);
  });

  it("se piden los dos permisos al emitir el token", () => {
    const cliente = sinComentarios("src/lib/membego-platform.ts");
    expect(cliente).toMatch(/scope: REQUIRED_SCOPES\.join\(" "\)/);
  });

  it("cancelar una reserva devuelve el beneficio, y no tumba la cancelación si falla", () => {
    // El cliente perdió un uso por una venta que no llegó a existir. Y que
    // MembeGo no conteste no puede dejar la reserva a medio cancelar.
    const src = sinComentarios("src/lib/booking-cancel-service.ts");
    expect(src).toMatch(/await reverseForOrder\(/);
    const at = src.indexOf("await reverseForOrder(");
    expect(src.slice(Math.max(0, at - 300), at), "la reversa no está protegida").toMatch(/try \{/);
  });

  it("la venta rebajada recalcula su total en vez de quedarse con el de antes", () => {
    // Sin esto, la línea baja y la orden sigue cobrando el importe original.
    const src = sinComentarios("src/lib/membego-redemption-service.ts");
    const rebaja = src.indexOf('await tenantUpdate(companyId, "booking", chosen.id, {');
    const sync = src.indexOf("await syncOrderTotals(companyId, input.orderId)");
    expect(sync).toBeGreaterThan(rebaja);
  });

  it("el canje se ofrece sobre una venta creada, no sobre el carrito", () => {
    // Un uso consumido contra un carrito abandonado es un uso que el cliente
    // perdió sin recibir nada.
    const pos = read("src/app/dashboard/pos/page.tsx");
    const at = pos.indexOf("<MembegoBenefits");
    expect(at, "el canje no está montado en el punto de venta").toBeGreaterThan(-1);
    expect(pos.slice(Math.max(0, at - 200), at)).toMatch(/payFor\?\.order\?\._id/);
  });

  it("el importe a cobrar sigue al descuento en vez de quedarse con el total viejo", () => {
    // Si no, el cajero cobra de más un descuento que sí se aplicó.
    const pos = sinComentarios("src/app/dashboard/pos/page.tsx");
    expect(pos).toMatch(/const orderTotal = benefitTotal \?\? Number\(payFor\?\.order\?\.total \?\? 0\)/);
  });

  it("la consulta de beneficios es una lectura y el canje una escritura protegida", () => {
    const consulta = sinComentarios("src/app/api/membego/benefits/route.ts");
    expect(consulta).toMatch(/await requireTenant\(\)/);
    expect(consulta).not.toMatch(/requireTenantWrite/);

    const canje = sinComentarios("src/app/api/membego/redeem/route.ts");
    expect(canje).toMatch(/assertSameOriginMutation\(req\)/);
    expect(canje).toMatch(/await requireTenantWrite\(\)/);
  });

  it("el código de error de MembeGo llega a la pantalla en vez de convertirse en un 500", () => {
    // El cajero tiene que distinguir «no te quedan usos» de «no hay conexión»:
    // en el primer caso cobra completo, en el segundo espera un minuto.
    const canje = sinComentarios("src/app/api/membego/redeem/route.ts");
    expect(canje).toMatch(/err instanceof MembegoApiError/);
    expect(canje).toMatch(/code: err\.code/);
  });

  it("los códigos de error son los del contrato publicado por MembeGo", () => {
    // `code` es API y el satélite ramifica con él: renombrar uno rompe esto.
    const dominio = read("src/lib/membego-benefits.ts");
    for (const code of [
      "BENEFIT_NOT_ELIGIBLE", "REDEMPTION_CONFLICT", "IDEMPOTENCY_KEY_REQUIRED",
      "INSUFFICIENT_SCOPE", "COMPANY_NOT_ENTITLED", "API_KEY_NOT_SUPPORTED",
      "TOKEN_EXPIRED", "INVALID_CLIENT", "QUOTA_EXCEEDED", "PLATFORM_API_UNCONFIGURED",
    ]) {
      expect(dominio, `falta el código ${code} del contrato`).toContain(`${code}:`);
    }
  });

  it("una promoción no finge revertirse: se dice que hay que hacerlo a mano", () => {
    // MembeGo revierte membresías y no tiene el equivalente para promociones.
    // Callarlo dejaría al cliente con un uso gastado y al sistema diciendo
    // «listo».
    const dominio = sinComentarios("src/lib/membego-benefits.ts");
    expect(dominio).toMatch(/if \(row\.benefit_type === "PROMOTION"\) return "promotion"/);
    const servicio = sinComentarios("src/lib/membego-redemption-service.ts");
    expect(servicio).toMatch(/action: "membego_reversal_manual"/);
  });

  it("un canje fallido queda anotado en vez de perderse", () => {
    // Sin él, un «no me aplicó el descuento» no tiene dónde mirarse y el motivo
    // real de MembeGo se pierde.
    const servicio = sinComentarios("src/lib/membego-redemption-service.ts");
    expect(servicio).toMatch(/await recordFailure\(companyId, ctx\.userId, \{/);
    expect(servicio).toMatch(/status: "failed"/);
  });

  it("las credenciales de la API viven en el entorno y no en la base", () => {
    // Una credencial por empresa sería poner secretos en la base para resolver
    // algo que el contrato ya resuelve: la empresa viaja en cada llamada.
    const cliente = sinComentarios("src/lib/membego-platform.ts");
    expect(cliente).toMatch(/process\.env\.MEMBEGO_CLIENT_ID/);
    expect(cliente).toMatch(/process\.env\.MEMBEGO_CLIENT_SECRET/);
    const env = read(".env.example");
    expect(env).toContain("MEMBEGO_CLIENT_ID=");
    expect(env).toContain("MEMBEGO_CLIENT_SECRET=");
    // Y no hay ninguna columna que las guarde.
    const sql = read("supabase/migrations/0057_membego_redemptions.sql");
    expect(sql).not.toMatch(/client_secret/);
  });
});

describe("analítica: que una previsión no sea una corazonada con cara de cálculo", () => {
  /**
   * Una analítica equivocada es peor que ninguna, porque se toman decisiones
   * con ella: confirmar el segundo autobús, soltar cupo, cancelar. Lo que se
   * ata aquí son las tres formas concretas de que un número parezca sólido sin
   * serlo.
   */

  const sinComentarios = (file: string) =>
    read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("la curva se aprende de salidas PASADAS, no de las que están a medio vender", () => {
    // Meter las futuras haría creer que la venta se desploma cerca de la fecha.
    const src = sinComentarios("src/lib/analytics-service.ts");
    const at = src.indexOf("let departureQuery");
    expect(at).toBeGreaterThan(-1);
    const consulta = src.slice(at, src.indexOf("const { data: departures }", at));
    expect(consulta).toMatch(/\.lt\("departure_at", now\.toISOString\(\)\)/);
  });

  it("las cohortes no cuentan reservas canceladas", () => {
    // Inflarían la retención con clientes que pidieron y no llegaron a viajar.
    const src = sinComentarios("src/lib/analytics-service.ts");
    expect(src).toMatch(/\.in\("status", VALID_BOOKING\)/);
    const validos = /const VALID_BOOKING = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
    expect(validos).not.toContain("cancelled");
    expect(validos).not.toContain("refunded");
    expect(validos).not.toContain("draft");
  });

  it("lo vendido incluye lo retenido: una plaza en retención ocupa el asiento", () => {
    // Prever sin ella diría que hay sitio de sobra justo en la salida que está
    // a punto de llenarse.
    const src = sinComentarios("src/lib/analytics-service.ts");
    expect(src).toMatch(/Number\(departure\.booked_pax \?\? 0\) \+ Number\(departure\.pending_pax \?\? 0\)/);
  });

  it("no se prevé dividiendo por una cuota minúscula", () => {
    // A 80 días con el 2 % vendido, dividir entre 0,02 convierte dos plazas en
    // cien.
    const src = sinComentarios("src/lib/analytics.ts");
    expect(src).toMatch(/if \(!\(share >= MIN_CURVE_SHARE\)\)/);
  });

  it("sin historia no se inventa una previsión", () => {
    const src = sinComentarios("src/lib/analytics.ts");
    expect(src).toMatch(/if \(input\.curve\.sample === 0 \|\| input\.curve\.share\.length === 0\)/);
  });

  it("una previsión sin confianza no dispara alerta de ocupación", () => {
    const src = sinComentarios("src/lib/analytics.ts");
    const at = src.indexOf("export function departureAlerts(");
    const cuerpo = src.slice(at);
    expect(cuerpo).toMatch(/if \(forecast\.confidence === "none"\) continue;/);
    // Y lo que sí se avisa siempre es lo que no necesita previsión.
    expect(cuerpo.indexOf('kind: "over_capacity"')).toBeLessThan(cuerpo.indexOf('if (forecast.confidence === "none") continue;'));
    expect(cuerpo.indexOf('kind: "no_pickup"')).toBeLessThan(cuerpo.indexOf('if (forecast.confidence === "none") continue;'));
  });

  it("solo se avisa dentro del horizonte en el que se puede hacer algo", () => {
    // Una salida a cuatro meses no admite ninguna decisión hoy, y el ruido hace
    // que se dejen de mirar las alertas que sí importan.
    const src = sinComentarios("src/lib/analytics.ts");
    expect(src).toMatch(/if \(departure\.daysOut > thresholds\.horizonDays\) continue;/);
  });

  it("la pantalla enseña de cuántas salidas se aprendió la curva", () => {
    // Sin ese número, una previsión de una operadora recién estrenada tendría
    // el mismo aspecto que una con tres años de historia.
    const api = sinComentarios("src/app/api/analytics/occupancy/route.ts");
    expect(api).toMatch(/occupancyReport/);
    const servicio = sinComentarios("src/lib/analytics-service.ts");
    expect(servicio).toMatch(/curveSample: curve\.sample/);
    const pantalla = read("src/app/dashboard/analitica/ocupacion/page.tsx");
    expect(pantalla).toMatch(/curveSample/);
  });

  it("la analítica es una lectura y no la bloquea una suscripción vencida", () => {
    for (const ruta of ["src/app/api/analytics/cohorts/route.ts", "src/app/api/analytics/occupancy/route.ts"]) {
      const src = sinComentarios(ruta);
      expect(src, ruta).toMatch(/await requireTenant\(\)/);
      expect(src, ruta).not.toMatch(/requireTenantWrite/);
      // Y con techo de peticiones: un informe pesado repetido en bucle tumba a
      // la operadora que más datos tiene, que es la que más lo necesita.
      expect(src, ruta).toMatch(/assertRateLimit/);
    }
  });

  it("las consultas de analítica están acotadas", () => {
    const src = sinComentarios("src/lib/analytics-service.ts");
    expect(src).toMatch(/const MAX_ROWS = \d+/);
    // Ninguna lectura sin `.limit(`: un barrido sin techo no se nota en la
    // operadora de tres salidas y tumba a la de treinta al día.
    const selects = [...src.matchAll(/\.from\("(\w+)"\)/g)].length;
    const limites = [...src.matchAll(/\.limit\(/g)].length;
    expect(limites, "hay consultas de analítica sin techo de filas").toBeGreaterThanOrEqual(selects);
  });

  it("las pantallas de analítica están en el menú", () => {
    const nav = read("src/lib/nav.ts");
    expect(nav).toContain('href: "/dashboard/analitica/cohortes"');
    expect(nav).toContain('href: "/dashboard/analitica/ocupacion"');
  });
});

describe("i18n: que el huésped que no habla español entienda lo que compró", () => {
  /**
   * ────────────────────────────────────────────────────────────────────────
   * EL FALLO QUE ESTO ARREGLA
   *
   * El mecanismo de idiomas existía desde la ola 3 —`resolveTemplate` buscaba
   * la plantilla del idioma del cliente— y NO HABÍA una sola plantilla que no
   * fuera española. Buscaba el inglés, no lo encontraba y caía al español, así
   * que el turista que reservaba en inglés recibía la confirmación, el
   * recordatorio de la víspera y el recibo en un idioma que no lee.
   *
   * El recordatorio de la víspera es el que más importa: lleva la hora y el
   * lugar de recogida. Un huésped que no lo entiende no es un huésped molesto,
   * es un asiento vacío y una reclamación.
   */

  const sinComentarios = (file: string) =>
    read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("cada plantilla española tiene su equivalente en inglés", () => {
    // Si falta una, no se rompe nada: cae al español. Por eso nadie se entera.
    const src = read("src/lib/messaging/templates.ts");
    const entradas = [...src.matchAll(/key: "(\w+)", channel: "(\w+)", language: "(\w+)"/g)]
      .map((m) => ({ key: m[1], channel: m[2], language: m[3] }));
    const es = entradas.filter((e) => e.language === "es");
    const en = new Set(entradas.filter((e) => e.language === "en").map((e) => `${e.key}:${e.channel}`));
    const faltan = es.filter((e) => !en.has(`${e.key}:${e.channel}`)).map((e) => `${e.key}/${e.channel}`);
    expect(faltan, "plantillas sin versión en inglés").toEqual([]);
    expect(es.length).toBeGreaterThan(0);
  });

  it("a los diccionarios no les falta ninguna clave", () => {
    // Un botón en español en medio de una página en inglés: no rompe, solo
    // queda mal, y por eso nadie lo reporta.
    const src = read("src/lib/i18n.ts");
    const bloque = (nombre: string) => {
      const at = src.indexOf(`const ${nombre}: Dictionary = {`);
      return src.slice(at, src.indexOf("\n};", at));
    };
    const claves = (nombre: string) => new Set([...bloque(nombre).matchAll(/^\s+"([^"]+)":/gm)].map((m) => m[1]));
    for (const [a, b] of [["PUBLIC_ES", "PUBLIC_EN"], ["DOC_ES", "DOC_EN"]] as const) {
      const faltan = [...claves(a)].filter((k) => !claves(b).has(k));
      expect(faltan, `claves que le faltan a ${b}`).toEqual([]);
      expect(claves(a).size).toBeGreaterThan(5);
    }
  });

  it("el idioma se decide en el SERVIDOR, antes de pintar", () => {
    // Detectarlo en el navegador enseñaría la página en español durante el
    // primer pintado, que es justo el segundo en el que el cliente decide si
    // se queda.
    const page = sinComentarios("src/app/reservar/[slug]/page.tsx");
    expect(page).toMatch(/pickLocale\(\{/);
    expect(page).toMatch(/acceptLanguage: \(await headers\(\)\)\.get\("accept-language"\)/);
    expect(page).toMatch(/locale=\{locale\}/);
  });

  it("la página pública no se cachea en un solo idioma", () => {
    // Con `revalidate`, la primera visita fijaría el HTML para todos: a un
    // inglés le tocaría la versión que pidió un español diez segundos antes.
    const page = sinComentarios("src/app/reservar/[slug]/page.tsx");
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).not.toMatch(/export const revalidate/);
  });

  it("el idioma en el que reservó queda en su ficha", () => {
    // Los avisos de la víspera salen cuando ya no hay navegador del que
    // deducirlo.
    const motor = sinComentarios("src/app/reservar/[slug]/_components/booking-engine.tsx");
    expect(motor).toMatch(/language: locale,/);
    const servicio = sinComentarios("src/lib/public-booking-service.ts");
    expect(servicio).toMatch(/language: request\.language/);
    // Y se refresca en la ficha que ya existía: quien reservó en español el año
    // pasado y hoy reserva en inglés está diciendo en qué idioma quiere que le
    // escriban AHORA.
    expect(servicio).toMatch(/\.update\(\{ language: request\.language \}\)/);
  });

  it("el voucher sale en el idioma del huésped, no en el de la operadora", () => {
    // Lo enseña ÉL en la puerta, a veces a alguien que no lo emitió.
    const doc = sinComentarios("src/lib/pdf/documents.ts");
    expect(doc).toMatch(/const locale = normalizeLocale\(data\.language\) \?\? DEFAULT_LOCALE/);
    expect(doc).toMatch(/const t = translator\(DOC_DICTIONARY, locale\)/);
    // Y la fecha también: un voucher que mezcla formatos se lee dos veces.
    expect(doc).toMatch(/formatDateFor\(locale, data\.travel_date\)/);
  });

  it("los dos sitios que emiten el voucher le pasan el idioma", () => {
    for (const ruta of ["src/app/api/bookings/[id]/voucher/route.ts", "src/lib/messaging/attachments.ts"]) {
      expect(sinComentarios(ruta), ruta).toMatch(/language: \(row|language: \(booking/);
    }
    // Y la consulta lo TRAE: sin la columna, el idioma es siempre undefined y
    // el voucher adjunto sale siempre en español.
    expect(read("src/lib/messaging/attachments.ts"))
      .toContain("customer:customer_id (first_name, last_name, language)");
  });

  it("el idioma que manda una OTA no se tira a la basura", () => {
    // OCTO manda `locales` en el contacto: ahí es donde el revendedor dice en
    // qué idioma habla su cliente.
    const src = sinComentarios("src/lib/octo-service.ts");
    expect(src).toMatch(/language: normalizeLocale\(input\.contact\?\.locales\?\.\[0\]\)/);
  });

  it("nunca se enseña la clave del diccionario", () => {
    // Una pantalla que dice `engine.submit` parece rota; el español se entiende
    // con el contexto mucho mejor que eso.
    const src = sinComentarios("src/lib/i18n.ts");
    expect(src).toMatch(/dictionaries\[locale\]\?\.\[key\] \?\? dictionaries\[DEFAULT_LOCALE\]\?\.\[key\] \?\? key/);
  });

  it("el panel de la operadora NO se traduce, y es una decisión escrita", () => {
    // Traducir cuarenta pantallas de gestión para un equipo que trabaja en
    // español es el trabajo que parece internacionalización y no sirve a nadie.
    // La guarda existe para que nadie lo empiece «por completar».
    const src = read("src/lib/i18n.ts");
    expect(src).toMatch(/NO se traduce el panel de la operadora/);
    const claves = [...src.matchAll(/^\s+"([^"]+)":/gm)].map((m) => m[1]);
    /**
     * Las cuatro superficies que SÍ ve el huésped, y ninguna más:
     * `engine.`/`page.` (la página pública), `doc.` (voucher y documentos),
     * `lang.` (el selector) y `survey.` (la encuesta de después del viaje, que
     * el cliente abre desde SU correo y en SU idioma).
     */
    const fuera = claves.filter((k) =>
      !k.startsWith("engine.") && !k.startsWith("page.") &&
      !k.startsWith("doc.") && !k.startsWith("lang.") && !k.startsWith("survey."));
    expect(fuera, "claves de i18n fuera de las superficies del huésped").toEqual([]);
  });
});

describe("Quién trajo al cliente (0058)", () => {
  /** El fuente sin comentarios: lo que se comprueba es el código, no la prosa. */
  const sinComentarios = (file: string) =>
    read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("la cookie nunca dice quién es el vendedor: se vuelve a resolver contra la base", () => {
    /**
     * La cookie la escribe el cliente. Si guardara el id del vendedor —o el de
     * la empresa—, cualquiera podría editarla y atribuirse las ventas de la
     * operadora entera. Guarda el SLUG, y el slug se resuelve siempre.
     */
    const ruta = read("src/app/e/[slug]/route.ts");
    expect(ruta).toContain("resolveLinkBySlug");
    expect(ruta).toContain("REFERRAL_COOKIE, link.slug");
    // Lo que NO puede aparecer: escribir el vendedor o la empresa en la cookie.
    expect(ruta).not.toMatch(/cookies\.set\([^)]*link\.(sellerId|companyId)/);

    // Y del lado de la venta, lo mismo: se resuelve, no se cree.
    const servicio = read("src/lib/public-booking-service.ts");
    expect(servicio).toContain("await resolveLinkBySlug(trace.referralSlug)");
    // El enlace de OTRA empresa no atribuye nada en esta.
    expect(servicio).toContain("link.companyId === orgId");
  });

  it("el embudo es de solo lectura desde el CRUD genérico", () => {
    // La base lo sostiene con un disparador; esto impide que el recurso abra
    // una puerta que el esquema cierra.
    const recursos = read("src/lib/resources.ts");
    const bloque = /seller_attribution:\s*\{([\s\S]*?)\n  \},/.exec(recursos)?.[1] ?? "";
    expect(bloque, "no se encontró el recurso seller_attribution").not.toBe("");
    expect(bloque).toMatch(/writable:\s*\[\s*\]/);
  });

  it("un vendedor escogido a mano no lo pisa el histórico, y a quien vende no lo pisa nadie", () => {
    /**
     * Dos reglas que conviven, y la segunda llegó después.
     *
     *  1. Quien está delante del cliente decide: pisar su elección con el
     *     histórico sería discutirle a quien vendió quién vendió.
     *  2. Pero si quien vende ES un vendedor, no elige: la venta se sella a su
     *     nombre. Elegir a otro era regalar —o quedarse— una comisión.
     *
     * Y el sello NO puede apagar el motor de atribución de la web: ahí no hay
     * persona, la cookie del visitante es lo único que encuentra al conserje
     * que compartió el enlace, y por eso la pregunta la responde
     * `ventaSelladaPorVendedor` (que exige usuario) y no el rol a secas.
     */
    const src = sinComentarios("src/lib/booking-service.ts");
    expect(src).toMatch(/const selladaPorPersona = ventaSelladaPorVendedor\(ctx\);/);
    expect(src).toMatch(
      /let attributedSeller = selladaPorPersona \? ctx\.sellerId \?\? null : input\.seller_id \|\| null;/
    );
    // El histórico sigue corriendo cuando no hay nadie delante…
    expect(src).toMatch(
      /if \(!attributedSeller && !selladaPorPersona\) \{\s*const attribution = await resolveOrderAttribution/
    );
    // …y los dos motores sin sesión siguen sin usuario, que es la marca de la
    // que depende todo lo anterior.
    for (const file of ["src/lib/public-booking-service.ts", "src/lib/octo-service.ts"]) {
      expect(sinComentarios(file), file).toMatch(/userId: ""/);
    }
  });

  it("la compra se anota una sola vez aunque se cobre a plazos", () => {
    // Sin esto, quien cobra en tres plazos parecería el triple de bueno que
    // quien cobra de una vez.
    const src = read("src/lib/attribution-service.ts");
    expect(src).toContain("recordPurchaseOnce");
    expect(src).toMatch(/\.eq\("stage", "purchase"\)/);
    const venta = sinComentarios("src/lib/booking-service.ts");
    expect(venta).toMatch(/if \(status === "paid"\)/);
  });

  it("la pantalla dice «—» y no «0 %» cuando no hubo visitas", () => {
    // Cero por ciento significa que vinieron y no compraron, que es un problema
    // distinto y se arregla de otra manera.
    const page = read("src/app/dashboard/vendedores/atribucion/page.tsx");
    expect(page).toMatch(/value === null \? "—"/);
    expect(page).toContain("Todavía no ha entrado nadie por un enlace");
    // El QR se descarga del servidor, que es quien conoce el dominio real.
    expect(page).toContain("/api/attribution/links/${l._id}/qr");
  });
});

describe("Comisiones: explicarlas y corregirlas (0059)", () => {
  const sinComentarios = (file: string) =>
    read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("cada tipo de cálculo del enum tiene su caso, ninguno cae al genérico", () => {
    /**
     * Esta es la guarda que faltaba. `net_rate` y `markup` se ofrecían en la
     * pantalla y caían al `return` final, así que se pagaban como porcentaje —
     * durante dos años, sin que nada avisara, porque una comisión mal calculada
     * no da error: da una cifra.
     */
    const engine = read("src/lib/commission-engine.ts");
    const labels = read("src/lib/labels.ts");
    const tipos = /export const CALC_TYPE[\s\S]*?\n\};/.exec(labels)?.[0] ?? "";
    expect(tipos, "no se pudo leer CALC_TYPE").not.toBe("");

    const ofrecidos = [...tipos.matchAll(/^\s{2}(\w+):\s*def\(/gm)].map((m) => m[1]);
    expect(ofrecidos.length).toBeGreaterThan(5);

    const sinCaso = ofrecidos.filter((t) => !engine.includes(`case "${t}":`));
    expect(sinCaso, "tipos de cálculo que la pantalla ofrece y el motor no implementa").toEqual([]);
  });

  it("un tipo desconocido paga cero pero lo dice en el desglose", () => {
    // Callarse es exactamente lo que hizo el código anterior. Ese texto acaba
    // impreso en la liquidación del vendedor, que es quien lo va a leer.
    const engine = read("src/lib/commission-engine.ts");
    expect(engine).toContain("no reconocido: comisión en cero");
    expect(engine).toContain("revisa la regla");
  });

  it("una comisión ya pagada se ajusta, nunca se anula", () => {
    // Bajar el importe a cero dejaría el histórico diciendo que siempre fue
    // cero. El ajuste deja las dos cifras a la vista.
    const dominio = sinComentarios("src/lib/commission-adjustments.ts");
    expect(dominio).toMatch(/MONEY_IS_OUT = new Set<CommissionState>\(\["settled", "paid"\]\)/);

    const servicio = sinComentarios("src/lib/commission-adjust-service.ts");
    // Al ajustar NO se toca el estado: sigue pagada, porque se pagó.
    const bloqueAjuste = /if \(effect\.action === "adjust"\) \{[\s\S]*?\n    \}/.exec(servicio)?.[0] ?? "";
    expect(bloqueAjuste, "no se encontró el bloque de ajuste").not.toBe("");
    expect(bloqueAjuste).not.toMatch(/status:\s*"cancelled"/);
  });

  it("la cancelación de una reserva ya no deja las comisiones pagadas sin tocar", () => {
    // Antes anulaba `pending` y `approved` y NO MIRABA las `paid`: el dinero
    // había salido y no quedaba rastro de que hubiera que recuperarlo.
    const cancel = sinComentarios("src/lib/booking-cancel-service.ts");
    expect(cancel).toContain("settleCommissionsOnCancel");
    expect(cancel).not.toMatch(/status:\s*\{\s*in:\s*\["pending",\s*"approved"\]\s*\}/);
  });

  it("un ajuste no se crea por el CRUD genérico, que dejaría el neto desfasado", () => {
    const recursos = read("src/lib/resources.ts");
    const bloque = /commission_adjustment:\s*\{([\s\S]*?)\n  \},/.exec(recursos)?.[1] ?? "";
    expect(bloque, "no se encontró el recurso commission_adjustment").not.toBe("");
    expect(bloque).toMatch(/writable:\s*\[\s*\]/);

    // Y la ruta dedicada sí sincroniza el neto.
    const servicio = read("src/lib/commission-adjust-service.ts");
    expect(servicio).toContain("syncCommissionNet");
  });

  it("la pantalla enseña el importe Y el ajuste, no uno en lugar del otro", () => {
    const page = read("src/app/dashboard/comisiones/page.tsx");
    expect(page).toContain("en ajustes");
    expect(page).toContain('header: "A pagar"');
    expect(page).toContain("/api/commissions/adjust");
  });
});

describe("Metas y bonos (0060)", () => {
  const sinComentarios = (file: string) =>
    read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("un premio en especie NO se transfiere: la liquidación lo separa", () => {
    /**
     * Es el fallo que esto evita: sumar un pase regalado al total a pagar hace
     * que la operadora transfiera dinero por algo que ya entregó — y el
     * vendedor no va a ser quien lo reporte.
     */
    const dominio = sinComentarios("src/lib/seller-goals.ts");
    expect(dominio).toMatch(/if \(normalizePayoutKind\(bonus\.payout_kind\) === "in_kind"\) inKind \+= amount;/);
    expect(dominio).toMatch(/return Math\.round\(\(num\(commissionNet\) \+ totals\.cash\) \* 100\) \/ 100;/);

    // Y quien genera la liquidación transfiere solo lo que es dinero.
    const generate = sinComentarios("src/app/api/settlements/generate/route.ts");
    expect(generate).toMatch(/pending_total: round2\(commissionTotal \+ bonusTotals\.cash\)/);
    expect(generate).toMatch(/in_kind_total: bonusTotals\.inKind/);
    // Lo que se debe de verdad es lo mismo que se transfiere.
    expect(generate).toMatch(/balance: round2\(commissionTotal \+ bonusTotals\.cash\)/);
  });

  it("la liquidación paga el NETO de la comisión, no lo que decía al nacer", () => {
    // Una comisión con ajustes vale su neto (0059). Sumar `amount` pagaría otra
    // vez lo que ya se descontó, y el descuadre aparecería en el banco.
    const generate = sinComentarios("src/app/api/settlements/generate/route.ts");
    expect(generate).toMatch(/commissionTotal \+= fresh\.net_amount \?\? fresh\.amount \?\? 0;/);
  });

  it("el progreso se mide, no se guarda en un contador", () => {
    // Un contador denormalizado sería un segundo sitio donde se decide si
    // alguien cobra su premio, y nadie mira un contador: solo la barra.
    const servicio = sinComentarios("src/lib/seller-goals-service.ts");
    expect(servicio).toContain('.from("seller_attribution")');
    expect(servicio).toContain('.from("booking")');
    // Y una reserva en borrador o cancelada no cuenta como venta.
    expect(servicio).toMatch(/COUNTED_BOOKING = \[\s*"confirmed", "partially_paid", "paid", "checked_in", "completed",/);
  });

  it("una meta se cumple cuando se cumplen TODAS sus dimensiones", () => {
    // «40 ventas y 150 pasajeros» es UNA meta con dos condiciones: dar por
    // buena la primera y pagar el premio sería regalarlo a medias.
    const dominio = sinComentarios("src/lib/seller-goals.ts");
    expect(dominio).toMatch(/return lines\.length > 0 && lines\.every\(\(l\) => l\.met\);/);
  });

  it("el bono lo otorga una persona, no el sistema", () => {
    // Un premio automático sobre una meta que alguien bajó el día 30 se pagaría
    // sin que nadie lo mirara.
    const servicio = sinComentarios("src/lib/seller-goals-service.ts");
    expect(servicio).toContain("awardGoalBonus");
    // Y no se otorga dos veces por dos clics o un reintento.
    expect(servicio).toContain("ya tiene el bono de esta meta");
    // Con la condición congelada dentro.
    expect(servicio).toContain("achievementSnapshot");
  });

  it("la pantalla solo pinta lo que la meta pide", () => {
    const page = read("src/app/dashboard/vendedores/metas/page.tsx");
    expect(page).toContain("row.lines.map");
    expect(page).toContain("Faltan ");
    // Y avisa de que lo que está en especie no se transfiere.
    expect(page).toContain("no se transfiere");
  });
});

describe("Paquetes (0061)", () => {
  const sinComentarios = (file: string) =>
    read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("el navegador dice QUÉ paquete y QUÉ día, y nada más", () => {
    /**
     * Si mandara las salidas, mandaría también cuáles tienen sitio. Si mandara
     * los componentes, se cobraría a sí mismo cero por una excursión suelta —
     * un componente de paquete vale cero por diseño.
     */
    const ruta = sinComentarios("src/app/api/orders/route.ts");
    expect(ruta).toContain("delete item.bundle_component");
    expect(ruta).toContain("delete item.bundle_item_id");
    expect(ruta).toContain("delete item.bundle_group");

    // Y la expansión las vuelve a borrar antes de decidir nada.
    const servicio = sinComentarios("src/lib/booking-service.ts");
    expect(servicio).toMatch(/delete clean\.bundle_component;/);
  });

  it("el itinerario se resuelve en el servidor, al vender", () => {
    // Entre que se pintó la pantalla y se pulsó el botón, una salida puede
    // haberse llenado. Confiar en un itinerario de hace tres minutos es vender
    // una plaza que ya no existe.
    const servicio = sinComentarios("src/lib/booking-service.ts");
    expect(servicio).toContain("expandBundles");
    expect(servicio).toMatch(/input = \{ \.\.\.input, items: await expandBundles\(ctx, input\.items\) \}/);
    // Y si no se puede armar, la venta se rechaza antes de escribir nada.
    expect(servicio).toMatch(/if \(!plan \|\| plan\.blocker\)/);
  });

  it("cancelar el paquete cancela sus actividades", () => {
    // Sin esto quedarían tres reservas vivas ocupando plazas, con importe cero
    // y sin nadie que las reclame: el manifiesto llevaría gente que no sube.
    const cancel = sinComentarios("src/lib/booking-cancel-service.ts");
    expect(cancel).toMatch(/_filter: \{ bundle_booking: id \}/);
    expect(cancel).toContain("cancelBookingFully(ctx, component");
  });

  it("el motor no inventa salidas: solo usa las que están programadas y abiertas", () => {
    const servicio = sinComentarios("src/lib/bundle-service.ts");
    expect(servicio).toContain('.from("departure")');
    // Una salida cerrada, llena o cancelada no sirve para armar nada.
    expect(servicio).toMatch(/\.in\("status", \["available", "almost_full"\]\)/);
  });

  it("el día es el de la operadora, no el de UTC", () => {
    // Una salida a las 21:00 de Santo Domingo es del día 10 allí y del 11 en
    // UTC: resolver en UTC pondría un combo de un día en dos días distintos.
    const servicio = sinComentarios("src/lib/bundle-service.ts");
    expect(servicio).toContain("ctx.company as { timezone?: string }");
    expect(servicio).toContain("dayOf(at, timeZone)");
  });

  it("la pantalla explica qué choca, no solo que no se puede", () => {
    const page = read("src/app/dashboard/catalogo/paquetes/page.tsx");
    expect(page).toContain("{plan.blocker}");
    expect(page).toContain("plan.conflicts.map");
    expect(page).toContain("la actividad más ajustada");
  });
});


describe("alta de salidas y de reservas", () => {
  /**
   * Dos huecos distintos, y solo uno era una función que faltaba.
   *
   * SALIDAS tenía únicamente el generador de calendario —un producto repetido
   * por semanas—, que sirve para la temporada y no para lo de todos los días:
   * la salida del jueves a las 6, el charter que pidió un hotel, la extra de
   * Navidad. Para una sola fecha había que generar un calendario de una fecha, o
   * no había forma.
   *
   * RESERVAS sí tenía el botón, y hacía lo correcto. Se llamaba «Nueva venta»,
   * así que en una pantalla llamada Reservas nadie lo encontraba. La función
   * estaba; el nombre contaba el paso técnico en vez del resultado.
   */
  const salidas = read("src/app/dashboard/salidas/page.tsx");
  const reservas = read("src/app/dashboard/reservas/page.tsx");

  it("salidas ofrece crear UNA, además de generar el calendario", () => {
    expect(salidas).toContain("Nueva salida");
    expect(salidas).toContain('resource="departure"');
    // Y el generador sigue estando: son dos trabajos distintos, no uno que
    // sustituya al otro.
    expect(salidas).toContain("Generar salidas");
  });

  it("el alta de salida NO deja tocar el estado", () => {
    /**
     * `status` lo deriva `recalculateDeparture` de las reservas vivas, y por eso
     * `resources.ts` lo deja fuera de `writable`. Si este formulario lo ofreciera,
     * se podría reabrir a mano una salida llena y vender plazas que no existen.
     *
     * Se comprueba aquí y no solo en `resources.ts` porque el riesgo es que
     * alguien añada el campo al formulario sin mirar por qué no estaba.
     */
    const bloque = salidas.slice(salidas.indexOf('resource="departure"'));
    const form = bloque.slice(0, bloque.indexOf("onSaved"));
    expect(form).not.toMatch(/name:\s*"status"/);
  });

  it("reservas nombra el botón por lo que produce", () => {
    expect(reservas).toContain("Nueva reserva");
    expect(reservas).toContain('href="/dashboard/pos"');
  });
});

/**
 * UNA PANTALLA QUE ENSEÑA ALGO NO PUEDE CALLARSE CÓMO SE CREA.
 *
 * El fallo que esto vigila no da error ni deja rastro: la pantalla carga, se ve
 * bien, está vacía, y no hay botón. Quien la abre concluye que el módulo «no
 * funciona» y deja de usarlo. Es lo que pasaba con «Mi día», que enseñaba tareas
 * que solo podían llegar desde una incidencia o un cron.
 *
 * LO QUE ESTA GUARDA PRUEBA, Y LO QUE NO
 *
 * Prueba que la pantalla OFRECE un camino de alta. No prueba que funcione: una
 * pantalla con un botón «Nuevo…» que no guardara nada pasaría igual. Eso es un
 * límite de leer el código en vez de ejecutarlo, y se acepta a sabiendas —lo que
 * esto persigue es la pantalla que no ofrece NADA, que es el fallo que de verdad
 * se da—. Que el alta escriba columnas que existen lo cubre la guarda de esquema;
 * que la acción haga su trabajo, las pruebas de su API.
 *
 * NO toda pantalla necesita un alta, y por eso la lista de abajo existe con un
 * motivo escrito en cada línea. Un asiento contable tecleado a mano rompe el
 * cuadre; un nivel de existencias sale de los movimientos, no del teclado. Ahí
 * añadir un botón no sería una mejora: sería un fallo.
 */
describe("cada pantalla dice cómo se crea lo que enseña", () => {
  const DASHBOARD = path.join(ROOT, "src/app/dashboard");

  /**
   * Las pantallas SIN alta a propósito, y por qué.
   *
   * Que esté aquí es una decisión, no un pendiente. Si alguien quita una línea
   * porque «le falta el botón», el motivo está al lado para discutirlo antes.
   */
  const DERIVADAS: Record<string, string> = {
    "/dashboard/finanzas/diario": "asientos contables: los genera cada operación; teclearlos a mano rompe el cuadre",
    "/dashboard/finanzas/estados": "estados financieros: se calculan del mayor",
    "/dashboard/finanzas/declaraciones": "606/607/608: se derivan de las ventas del periodo",
    "/dashboard/finanzas/vencimientos": "cobros pendientes: nacen de la venta, no se inventan",
    "/dashboard/comercio/existencias": "niveles de stock: salen de los movimientos; escribirlos hace que el almacén mienta",
    "/dashboard/equipo/acuses": "acuses de lectura: los firma quien lee",
    "/dashboard/analitica/ocupacion": "previsión: se calcula de las salidas",
    "/dashboard/analitica/reportes": "informes: se calculan",
    "/dashboard/reportes/antiguedad-saldos": "foto de saldos: los documentos los crean facturación y compras; una deuda no se «da de alta» desde el reporte que la mide",
    "/dashboard/reportes/declaracion-dgii": "declaración fiscal: se arma con las facturas y gastos ya emitidos; crear una línea aquí sería declarar algo que no ocurrió",
    "/dashboard/reportes/estados-financieros": "estados contables: se derivan de los asientos del libro diario, que son inmutables; no se teclea un balance",
    "/dashboard/reportes/cierre-del-dia": "documento de cierre: resume lo que la jornada YA produjo (salidas, ventas, cobros, caja); un botón de «nuevo» crearía el dato desde el resumen, que es al revés",
    "/dashboard/reportes/[slug]": "documento imprimible: es una FOTO de lo que otros módulos ya crearon, acotada a un período; un botón de «nuevo» aquí crearía el dato desde el reporte, que es justo al revés",
    "/dashboard/reportes/actividad": "bitácora: la escribe el sistema en cada acción y es inmutable; un botón de «nuevo evento» sería justo lo que una auditoría no puede permitir",
    "/dashboard/analitica/cohortes": "cohortes: se calculan",
    "/dashboard/rentabilidad": "márgenes: se calculan de ventas y costes",
    "/dashboard/mi-espacio": "el apartado del vendedor: es una FOTO de lo suyo —lo vendido, la comisión, la meta—; una venta se hace en el punto de venta, y la comisión y la meta las genera el sistema. Un botón de «nuevo» aquí dejaría al vendedor crearse su propia comisión",
    "/dashboard/mi-espacio/enlace": "su enlace y su QR: el enlace SÍ se crea aquí, pero con un botón propio y sin formulario de recurso —el slug no se elige, lo genera el servidor—, así que el detector de «cómo se crea esto» no lo reconoce",
    "/dashboard/mi-espacio/comisiones": "sus comisiones: las genera el devengo al confirmarse la venta y las liquida gerencia. Un botón de «nueva» aquí sería dejar que el vendedor se escriba su propia comisión, que es exactamente lo que este apartado no puede permitir",
    "/dashboard/mi-espacio/ventas": "sus ventas ya hechas: se crean en el punto de venta, que es donde está el cliente; esta pantalla las mira, no las inventa",
    "/dashboard/distribucion/matriz": "vista cruzada de disponibilidad ya existente",
    "/dashboard/distribucion/canales": "un canal no se crea, se conecta: aparece cuando un revendedor reserva por OCTO; se habilita en Integraciones",
    "/dashboard/inicio/notificaciones": "avisos: los emite el sistema",
    "/dashboard/administracion/aprobaciones": "solicitudes: nacen del flujo que las necesita",
    "/dashboard/administracion/exportar": "herramienta de salida de datos",
    "/dashboard/administracion/importar": "herramienta de entrada de datos",
    "/dashboard/administracion/plan": "plan contratado: se cambia desde la suscripción",
    "/dashboard/checkin": "embarque: actúa sobre reservas que ya existen",
    "/dashboard/operaciones/despacho": "despacho: actúa sobre salidas que ya existen",
    "/dashboard/salidas/[id]/manifiesto": "manifiesto: se deriva de las reservas de la salida",
    "/dashboard/clientes/vouchers": "vouchers: los emite la venta",
    "/dashboard/clientes/opiniones":
      "opiniones: las escribe el pasajero desde su enlace. Un botón de «nueva opinión» " +
      "en el panel permitiría a la operadora escribir la nota de sus propios clientes, " +
      "que es exactamente lo que hace que un NPS no valga nada",
    "/dashboard/operaciones/rutas/[id]/hoja":
      "hoja de ruta: sus paradas las coloca «Armar rutas» en el despacho; " +
      "teclearlas aquí a mano las descolocaría en el siguiente rearmado",
  };

  /**
   * El texto de la pantalla, sus componentes y SUS FICHEROS HERMANOS.
   *
   * Lo de los hermanos importa: la primera versión de esta comprobación solo
   * leía `page.tsx` y `_components/`, y por eso dio por incompleta la pantalla de
   * Tareas — cuyo `create-task-dialog.tsx` vive al lado de `page.tsx`. Una
   * comprobación que denuncia lo que ya está resuelto se desactiva a la tercera.
   */
  function screenSource(pageFile: string): string {
    let src = "";
    const dir = path.dirname(pageFile);
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop()!;
      for (const entry of readdirSync(d)) {
        const f = path.join(d, entry);
        if (statSync(f).isDirectory()) {
          // Solo los componentes propios: una subruta es OTRA pantalla y tiene
          // que responder por sí misma.
          if (entry.startsWith("_")) stack.push(f);
        } else if (/\.tsx$/.test(entry)) {
          src += "\n" + readFileSync(f, "utf8");
        }
      }
    }
    return src;
  }

  /** ¿Hay algún POST a una URL sin identificador incrustado? */
  function postsToCollection(src: string): boolean {
    for (const m of src.matchAll(/api\.post[^(]*\(\s*[`"']([^`"']+)/g)) {
      if (!m[1].includes("${")) return true;
    }
    return /method:\s*"POST"/.test(src);
  }

  function dashboardPages(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const f = path.join(dir, entry);
      if (statSync(f).isDirectory()) dashboardPages(f, out);
      else if (entry === "page.tsx") out.push(f);
    }
    return out;
  }

  it("ninguna enseña registros sin ofrecer cómo crearlos", () => {
    const mudas: string[] = [];

    for (const file of dashboardPages(DASHBOARD)) {
      const route = "/" + path.relative(path.join(ROOT, "src/app"), file).replace(/\/page\.tsx$/, "");
      if (route in DERIVADAS) continue;

      const src = screenSource(file);
      const enseñaRegistros = /<ResourcePage|<SimpleResource|<DataTable|\.map\(\(?\w+\)? =>/.test(src);
      if (!enseñaRegistros) continue;

      const ofreceAlta =
        /fields=\{\[/.test(src) ||
        /<DialogTrigger|setOpen\(true\)|setCreating\(|showCreate|<Create\w+Dialog/.test(src) ||
        // CREAR es postear a una COLECCIÓN, no a un identificador.
        //
        // Buscar `api.post` a secas no vale: casi toda pantalla postea algo
        // —canjear un ticket, anular, cerrar una caja— y eso no es un alta. Con
        // esa regla, la pantalla de tickets pasaba por completa mientras solo
        // sabía canjear y anular tickets que nada creaba.
        //
        // Una URL con `${…}` lleva dentro el identificador de una fila que ya
        // existe: es una acción sobre ella. Una sin él apunta a la colección, y
        // eso sí trae algo al mundo.
        postsToCollection(src) ||
        /href="\/dashboard\/(pos|reservar)/.test(src) ||
        />\s*(Nuev[ao]|Crear|Generar|Añadir|Registrar|Emitir)\b/.test(src);

      if (!ofreceAlta) mudas.push(route);
    }

    expect(
      mudas.sort(),
      "pantallas que enseñan registros y no dicen cómo crearlos (si es a propósito, apúntala en DERIVADAS con su motivo)"
    ).toEqual([]);
  });

  it("la lista de excepciones no esconde pantallas que ya no existen", () => {
    // Una excepción sobre una ruta borrada es una exención que nadie revisa y
    // que taparía la pantalla que ocupe ese sitio mañana.
    const rutas = new Set(
      dashboardPages(DASHBOARD).map(
        (f) => "/" + path.relative(path.join(ROOT, "src/app"), f).replace(/\/page\.tsx$/, "")
      )
    );
    const fantasmas = Object.keys(DERIVADAS).filter((r) => !rutas.has(r));
    expect(fantasmas, "excepciones sobre pantallas inexistentes").toEqual([]);
  });

  it("cada excepción explica por qué", () => {
    for (const [route, motivo] of Object.entries(DERIVADAS)) {
      expect(motivo.length, `${route} sin motivo`).toBeGreaterThan(20);
    }
  });
});

describe("la logística del día dice lo mismo en todas partes", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * DOS PANTALLAS QUE DEFINÍAN EL MISMO CAMPO DE FORMA DISTINTA
   *
   * `hotel.pickup_offset_min` se explicaba en Administración → Hoteles como
   * «minutos antes de la salida a los que pasa el transporte» —que es lo que el
   * motor hace— y en Recogidas como «minutos que se suman o restan a la hora de
   * la ruta», que es otra cosa. No es un matiz: con la segunda definición,
   * quien carga los hoteles pone un 10 donde hacía falta un 75, y el transporte
   * llega una hora tarde a todos los de esa zona.
   *
   * Dos definiciones del mismo dato garantizan que alguien lo cargue mal, y el
   * error no se ve hasta que hay clientes esperando en un lobby.
   */
  const ayudasDe = (campo: string): { archivo: string; texto: string }[] => {
    const out: { archivo: string; texto: string }[] = [];
    for (const file of walk(path.join(ROOT, "src/app/dashboard"))) {
      const src = readFileSync(file, "utf8");
      // El bloque del campo hasta su cierre, para leer su `help` y no el del vecino.
      const re = new RegExp(`name:\\s*"${campo}"[\\s\\S]{0,400}?\\}`, "g");
      for (const bloque of src.match(re) ?? []) {
        const help = /help:\s*"([^"]+)"/.exec(bloque);
        if (help) out.push({ archivo: path.relative(ROOT, file), texto: help[1] });
      }
    }
    return out;
  };

  it("el margen de recogida se explica igual en las dos pantallas que lo piden", () => {
    const ayudas = ayudasDe("pickup_offset_min");
    // Si nadie lo explica, la guarda no estaría comprobando nada.
    expect(ayudas.length, "nadie explica pickup_offset_min").toBeGreaterThanOrEqual(2);

    const discrepantes = ayudas.filter((a) => !/antes de la salida/i.test(a.texto));
    expect(
      discrepantes.map((d) => `${d.archivo}: «${d.texto}»`),
      "ayudas de pickup_offset_min que no dicen «antes de la salida»"
    ).toEqual([]);
  });

  it("lo que calcula el motor no se ofrece para teclear", () => {
    /**
     * `planned_time` es la hora que calcula el motor y `auto_key` la huella con
     * la que reconoce su propia ruta. Un formulario que las ofrezca devuelve la
     * hora de recogida a ser un texto suelto —el defecto que 0065 vino a
     * arreglar— y permite duplicar las rutas al rehacer el día.
     */
    const ofrecidos: string[] = [];
    for (const file of walk(path.join(ROOT, "src/app/dashboard"))) {
      const src = readFileSync(file, "utf8");
      for (const campo of ["planned_time", "auto_key"]) {
        if (new RegExp(`name:\\s*"${campo}"`).test(src)) {
          ofrecidos.push(`${path.relative(ROOT, file)}: ${campo}`);
        }
      }
    }
    expect(ofrecidos, "campos derivados ofrecidos en un formulario").toEqual([]);
  });

  it("tampoco son escribibles por la API genérica", () => {
    const recursos = read("src/lib/resources.ts");
    for (const campo of ["planned_time", "auto_key", "conflict_reason"]) {
      expect(
        new RegExp(`writable:[^\\]]*"${campo}"`).test(recursos),
        `${campo} no debe estar en ninguna lista de campos escribibles`
      ).toBe(false);
    }
  });
});

describe("el camino del dinero no se contradice a sí mismo", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * TRES LISTAS QUE DEBERÍAN SER UNA
   *
   * Los estados terminales de una reserva —cancelada, reembolsada, reembolsada
   * a medias— estaban escritos tres veces: una en `booking-cancel-service` y
   * dos dentro de `syncOrderTotals`. A las dos de `syncOrderTotals` les faltaba
   * `partially_refunded`, que es el estado de una cancelación con penalización,
   * o sea la más normal de todas.
   *
   * Lo que costaba: un cliente que cancelaba con diez horas de margen recibía
   * su 50 % y la reserva se quedaba con saldo positivo. El sistema creía que
   * debía dinero de una excursión cancelada y el cron de cobranza se lo
   * reclamaba.
   *
   * Una lista copiada acaba divergiendo. Esta guarda impide la copia.
   */
  /**
   * Los sitios donde la lista se escribe a mano CON MOTIVO.
   *
   * Todos son listas de estados de ORDEN, que es otro enum: `sales_order` no
   * tiene `partially_refunded` (0005). Mezclarlos con los de reserva sería el
   * error simétrico al que esta guarda persigue.
   */
  const AMANO: Record<string, string> = {
    "src/app/api/reports/collections/route.ts": "estados de ORDEN: una orden no puede estar parcialmente reembolsada",
    "src/lib/membego-benefits.ts": "estados de ORDEN",
    "src/lib/facturacion-automatica.ts": "estados de ORDEN: el enum de `sales_order` no tiene partially_refunded, y lo que se decide aquí es si una ORDEN saldada se factura",
  };

  it("la lista de estados de RESERVA se escribe una sola vez", () => {
    const culpables: string[] = [];
    for (const file of walk(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, file);
      if (rel.endsWith("types.ts") || rel in AMANO || /\.test\.tsx?$/.test(rel)) continue;
      const src = readFileSync(file, "utf8");
      // Una lista de estados de reserva que nombre cancelled y refunded y se
      // olvide de partially_refunded trata como viva una reserva cancelada.
      for (const lista of src.matchAll(/\[[^\]]*"cancelled"[^\]]*\]/g)) {
        const texto = lista[0];
        if (!texto.includes('"refunded"')) continue;
        if (texto.includes('"partially_refunded"')) continue;
        if (texto.includes("BOOKING_TERMINAL_STATES")) continue;
        culpables.push(`${rel}: ${texto.slice(0, 70)}`);
      }
    }
    expect(
      culpables,
      "una reserva reembolsada a medias sigue viva para estos: es el estado de una cancelación con penalización"
    ).toEqual([]);
  });

  it("y las excepciones apuntadas se aplican de verdad a una orden", () => {
    // Si alguien apunta aquí una lista de RESERVAS para callar la guarda, esto
    // lo dice: se lee el código alrededor de la lista y tiene que estar
    // hablando de una orden.
    for (const [archivo, motivo] of Object.entries(AMANO)) {
      expect(motivo, `${archivo}: el motivo apuntado tiene que decir por qué`).toMatch(/ORDEN/);
      const src = read(archivo);
      const lista = /\[[^\]]*"cancelled"[^\]]*"refunded"[^\]]*\]/.exec(src);
      expect(lista, `${archivo}: ya no tiene la lista que decía tener`).toBeTruthy();
      // Sin límites de palabra a propósito: los nombres reales son
      // `ctx.orderStatus`, `CLOSED_ORDER` y `row.order?.status`, y un `\border\b`
      // no casa con ninguno. Lo que se comprueba es que el código de alrededor
      // esté hablando de órdenes, no la ortografía del identificador.
      //
      // Y en los dos idiomas: los módulos de dominio de este repositorio se
      // escriben en castellano (`OrdenParaFacturar`), así que exigir la palabra
      // inglesa comprobaba el idioma del identificador en vez de lo que dice
      // comprobar.
      const alrededor = src.slice(Math.max(0, lista!.index - 600), lista!.index + 800);
      expect(alrededor, `${archivo}: la lista no se aplica a ninguna orden`).toMatch(/orders?|[oó]rdenes?/i);
    }
  });

  it("y quien la necesita la importa de ahí", () => {
    for (const file of ["src/lib/booking-service.ts", "src/lib/booking-cancel-service.ts"]) {
      expect(read(file), `${file} debe usar la lista compartida`)
        .toMatch(/isTerminalBookingStatus|BOOKING_TERMINAL_STATES/);
    }
  });

  it("incluye el reembolso parcial, que es el caso que se olvidaba", () => {
    const src = read("src/lib/types.ts");
    const lista = /BOOKING_TERMINAL_STATES\s*=\s*\[([^\]]+)\]/.exec(src)?.[1] ?? "";
    for (const estado of ["cancelled", "refunded", "partially_refunded"]) {
      expect(lista, `falta ${estado}`).toContain(`"${estado}"`);
    }
  });

  it("una reserva cancelada no se vuelve a cancelar, y la guarda vive en el servicio", () => {
    // Estaba en cada llamador. El módulo existe para que quien llame no tenga
    // que acordarse de las trece cosas que hay que hacer al cancelar.
    const src = read("src/lib/booking-cancel-service.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const cuerpo = src.slice(src.indexOf("export async function cancelBookingFully"));
    expect(cuerpo.slice(0, 1200)).toMatch(/isTerminalBookingStatus\(booking\.status\)/);
  });
});

/* ═══════════════════ ninguna escritura a la base sin mirar el error ══ */

describe("la base dice que no y alguien tiene que oírlo (AUD-M05)", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * EL ERROR VIENE DENTRO DEL RESULTADO, NO POR EXCEPCIÓN
   *
   * `supabaseService()` devuelve `{ data, error }`. Esto compila, pasa la
   * revisión y no hace nada:
   *
   *     await sb.from("sales_order").update({ hold_until }).eq("id", id);
   *
   * El `await` espera la respuesta y tira el error al suelo. Había veintiuna
   * escrituras así, más nueve en el conector de OTAs. Sus finales, comprobados:
   * una retención que no caduca nunca, el reintento de un socio que duplica la
   * venta, una suscripción cobrada que sigue en «pendiente de pago».
   *
   * La guarda no exige que todo lance: exige que todo MIRE. Tres formas valen y
   * una no:
   *
   *   · `mustWrite(…)` — la operación no vale sin esto.
   *   · `tryWrite(…)`  — lo que importaba ya pasó; se anota y se sigue.
   *   · `const { error } = await …` — a mano, mirando.
   *   · `await sb.from(…).update(…)` a secas — NO.
   */
  const ESCRITURA = /(?:\.update\(|\.insert\(|\.delete\(|\.upsert\()/;

  it("ninguna escritura con la llave de servicio ignora su error", () => {
    const culpables: string[] = [];
    for (const file of walk(path.join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("supabaseService") && !/\bsb\.from\(/.test(src)) continue;
      const re = /^([ \t]*)await\s+(?:sb|supabaseService\(\))\s*\n?\s*\.?from\(/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const frag = src.slice(m.index, m.index + 500);
        if (!ESCRITURA.test(frag)) continue;
        culpables.push(`${path.relative(ROOT, file).replace(/\\/g, "/")}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(culpables, "envuélvela en mustWrite o tryWrite, o destructura su error").toEqual([]);
  });

  it("los tres verbos existen y dicen lo que hacen", () => {
    const src = read("src/lib/supabase/io.ts");
    expect(src).toMatch(/export async function mustWrite/);
    expect(src).toMatch(/export async function tryWrite/);
    expect(src).toMatch(/export async function mustRead/);
    // `mustWrite` lanza; `tryWrite` devuelve si llegó, para que quien llama
    // pueda no contar como hecho lo que no se escribió.
    expect(src).toMatch(/throw Object\.assign\(/);
    expect(src).toMatch(/Promise<boolean>/);
  });

  it("el conector de OTAs mira TODAS sus lecturas que deciden plazas", () => {
    // Una lectura fallida devuelve `data: null`, que arriba es indistinguible
    // de «no hay nada» — y ese «no hay nada» es la rama que deja pasar una
    // reserva sin salida o duplica una retención.
    const src = read("src/lib/octo-service.ts");
    for (const fn of ["loadRow", "hasDepartures", "holdUntilOf"]) {
      const cuerpo = src.slice(src.indexOf(`function ${fn}`), src.indexOf(`function ${fn}`) + 1400);
      expect(cuerpo, `${fn} tiene que comprobar el error de su lectura`).toContain("mustRead");
    }
  });
});

/* ═══════════ el filtro por empresa en los servicios sin sesión ══ */

describe("la llave de servicio se salta la RLS: el filtro lo pone el código", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * POR QUÉ ESTA GUARDA ES DE CÓDIGO Y NO DE COMPORTAMIENTO
   *
   * Los servicios sin sesión consultan con la llave de servicio, que NO aplica
   * la RLS: cada `eq("organization_id", …)` que escriben a mano es la única
   * frontera entre dos operadoras.
   *
   * Y esos filtros se TAPAN ENTRE SÍ. Al mutarlos de uno en uno, las pruebas
   * seguían en verde: quitando el de la salida lo paraba el de las reservas, y
   * quitando el de las reservas lo paraba el de la salida. Hay una prueba
   * (`voice-service.test.ts`, «no le escribe a los pasajeros de la operadora de
   * al lado») que sí muere al quitar los dos, pero una guarda que solo muerde
   * con la mutación combinada deja borrar cualquiera de ellos sin que nadie se
   * entere. Esta lo impide de uno en uno.
   */
  const SIN_SESION = [
    "src/lib/voice-service.ts",
    "src/lib/octo-service.ts",
    /**
     * La liquidación a proveedores entra aquí aunque use el cliente CON sesión.
     *
     * Ahí la RLS sí es una barrera de verdad, así que el `eq` es cinturón y
     * tirantes — pero la mutación lo demostró: quitarlo no rompía ninguna
     * prueba. Y el día que alguien cambie ese cliente por el de servicio —para
     * un cron de liquidaciones, por ejemplo— el filtro ya tiene que estar
     * puesto, porque entonces es lo único que queda.
     */
    "src/lib/supplier-settlement-service.ts",
  ];

  it("toda consulta con la llave de servicio filtra por empresa", () => {
    const offenders: string[] = [];

    for (const file of SIN_SESION) {
      const src = read(file);
      for (const m of src.matchAll(/\.from\("([a-z_]+)"\)/g)) {
        const fin = src.indexOf(";", m.index ?? 0);
        const cadena = src.slice(m.index ?? 0, fin < 0 ? src.length : fin);
        if (cadena.includes("organization_id")) continue;

        /**
         * Las dos excepciones, y las dos con su motivo:
         *
         *  · buscar por TOKEN — la encuesta se resuelve desde una página sin
         *    sesión que no sabe de qué empresa es el cliente. Por eso el token
         *    es único en toda la tabla, con su comprobación en la prueba SQL.
         *  · la tabla `organizations` filtrada por `id` — ahí la empresa ES la
         *    fila; pedirle además un `organization_id` no querría decir nada.
         */
        const porToken = /\.eq\("token"/.test(cadena);
        const esLaEmpresa = m[1] === "organizations" && /\.eq\("id"/.test(cadena);
        if (porToken || esLaEmpresa) continue;

        offenders.push(`${file}:${src.slice(0, m.index).split("\n").length} → ${m[1]}`);
      }
    }

    expect(offenders, "sin RLS que lo tape, esto son filas de otra operadora").toEqual([]);
  });

  it("la encuesta se escribe diciendo de quién es", () => {
    // El `organization_id` va en el literal de cada alta y no escondido en un
    // objeto compartido: el campo que decide de quién es la fila tiene que
    // verse leyendo la escritura.
    const src = read("src/lib/voice-service.ts");
    const altas = [...src.matchAll(/from\("guest_survey"\)\.insert\(\{/g)];
    expect(altas.length, "las dos altas de encuesta").toBe(2);
    for (const m of altas) {
      const trozo = src.slice(m.index ?? 0, (m.index ?? 0) + 260);
      expect(trozo).toContain("organization_id");
    }
  });
});

describe("la puerta de entrada", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * LA ÚNICA PANTALLA QUE VE QUIEN NO HA ENTRADO
   *
   * Y por tanto la única pista que tiene. El mensaje que había afirmaba una
   * causa que el servidor no dice —«verifica que la cuenta exista en este
   * proyecto»— cuando `invalid_credentials` significa igualmente que la
   * contraseña está mal tecleada. Todo lo demás llegaba crudo y en inglés.
   *
   * El traductor vive en un solo sitio para que las tres pantallas de identidad
   * digan lo mismo del mismo fallo, y para que se pueda probar sin navegador.
   */
  const PANTALLAS = ["src/app/login/page.tsx", "src/app/register/page.tsx"];

  it("ninguna pantalla traduce los errores por su cuenta", () => {
    /**
     * La forma de volver al defecto es escribir otra vez un `if` con el texto
     * del proveedor en la pantalla. Cada copia envejece por separado: el día
     * que Supabase cambie el texto, una dice una cosa y la otra otra.
     */
    const offenders: string[] = [];
    for (const dir of ["src/app", "src/components"]) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (!/\.tsx?$/.test(file)) continue;
        const src = readFileSync(file, "utf8");
        if (/Invalid login credentials|Email not confirmed|User is banned/.test(src)) {
          offenders.push(path.relative(ROOT, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders, "el texto del proveedor solo se reconoce en src/lib/auth-errors.ts").toEqual([]);
  });

  it("y todas pasan por el traductor", () => {
    for (const pantalla of PANTALLAS) {
      const src = read(pantalla);
      expect(src, `${pantalla} enseña el fallo sin traducir`).toContain("describeAuthError");
      // El `.message` del proveedor puesto directamente en la alerta es
      // exactamente lo que el traductor existe para evitar.
      expect(src, `${pantalla} sigue pintando el texto crudo`).not.toMatch(
        /setError\(\s*(result\.)?error\.message/
      );
    }
  });

  it("el mensaje de credenciales no afirma dónde está el problema", () => {
    /**
     * La regla, no la implementación: da igual cómo se escriba el texto,
     * mientras no mande a buscar el fallo a un sitio que el servidor no ha
     * señalado. Quien administra tiene `npm run check:account`, que sí puede
     * mirar porque corre con credenciales y no delante de un desconocido.
     */
    const src = read("src/lib/auth-errors.ts");
    const textos = [...src.matchAll(/message:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(textos.length, "hay mensajes que revisar").toBeGreaterThan(4);
    for (const t of textos) {
      expect(t, `este mensaje adivina la causa: «${t}»`).not.toMatch(/este proyecto|este ambiente/i);
    }
  });

  it("el comprobador de cuentas existe y solo lee", () => {
    /**
     * Es la otra mitad del arreglo: la pantalla deja de adivinar porque hay
     * dónde mirar de verdad. Si el comprobador escribiera, sería un comprobador
     * que nadie ejecuta cuando hace falta —justo cuando algo ya va mal—.
     */
    const src = read("scripts/check-account.mjs");
    expect(JSON.parse(read("package.json")).scripts["check:account"]).toBeTruthy();
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src, "listar usuarios es una lectura; crearlos no").not.toMatch(/admin\.(createUser|updateUserById|deleteUser)/);
  });
});

describe("ninguna acción sin bitácora", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * LA REGLA
   *
   * Toda ruta que CAMBIA algo deja rastro: o llama a `writeAudit`, o delega en
   * un servicio que lo llama. Sin esto, la pantalla de Auditoría enseña una
   * parte de lo que pasó y da por hecho el resto — que es peor que no tenerla,
   * porque parece completa.
   *
   * El hueco era grande y silencioso: el CRUD genérico anotaba el BORRADO desde
   * el principio, pero no la creación ni la edición. O sea que casi todo lo que
   * se registra un día normal —un cliente, un proveedor, un gasto, un activo—
   * no dejaba constancia de quién lo hizo.
   */
  const MUTANTES = /export async function (POST|PUT|PATCH|DELETE)\b/;

  /**
   * Lo que legítimamente no se anota, con su motivo. La lista es corta a
   * propósito: cada entrada es una decisión, no un olvido.
   */
  const SIN_BITACORA: Record<string, string> = {
    "pricing/quote": "calcula un precio y no guarda nada: no hay acción que anotar",
    "octo/v1/availability": "consulta de disponibilidad de la OTA; es una lectura con verbo POST",
    "octo/v1/availability/calendar": "igual que la anterior: lectura con verbo POST",
    "notifications": "marcar avisos como leídos llenaría la bitácora de ruido sin valor",
    "notifications/[id]/read": "lo mismo: es estado de lectura de quien mira, no una acción sobre el negocio",
    "stripe/create-checkout-session": "abre una sesión de pago; lo que hay que anotar es el cobro, y eso lo hace el webhook",
    "stripe/customer-portal": "abre el portal del cliente en Stripe; no cambia nada aquí",
    "workspace": "el cambio de empresa ya escribe su propia auditoría con writeAudit",
  };

  function auditaPorSuCuenta(src: string) { return src.includes("writeAudit"); }

  /** Servicios de `src/lib` que anotan por dentro. */
  const SERVICIOS_QUE_ANOTAN = new Set(
    readdirSync(path.join(ROOT, "src/lib"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => readFileSync(path.join(ROOT, "src/lib", f), "utf8").includes("writeAudit"))
      .map((f) => f.replace(/\.ts$/, ""))
  );

  function delegaEnServicioQueAnota(src: string) {
    for (const m of src.matchAll(/from "@\/lib\/([a-z0-9-]+)"/g)) {
      if (SERVICIOS_QUE_ANOTAN.has(m[1])) return true;
    }
    return false;
  }

  it("toda ruta que cambia algo deja rastro", () => {
    const huerfanas: string[] = [];
    for (const file of walk(path.join(ROOT, "src/app/api"))) {
      if (!file.endsWith("route.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (!MUTANTES.test(src)) continue;

      const ruta = path.relative(path.join(ROOT, "src/app/api"), file)
        .replace(/\/route\.ts$/, "").replace(/\\/g, "/");
      if (ruta in SIN_BITACORA) continue;
      if (auditaPorSuCuenta(src) || delegaEnServicioQueAnota(src)) continue;
      huerfanas.push(ruta);
    }
    expect(huerfanas, "estas acciones cambian datos y no quedan en la bitácora").toEqual([]);
  });

  it("el CRUD genérico anota las tres cosas: crear, editar y borrar", () => {
    /**
     * Es por donde pasa la mayoría de lo que se registra a diario, así que si
     * alguna de las tres se cae, la bitácora deja de servir para reconstruir
     * nada. La regla se afirma sobre las ACCIONES, no sobre cómo estén escritas.
     */
    const crear = read("src/app/api/erp/[resource]/route.ts");
    const editarBorrar = read("src/app/api/erp/[resource]/[id]/route.ts");
    expect(crear, "crear").toContain("record_created");
    expect(editarBorrar, "editar").toContain("record_updated");
    expect(editarBorrar, "borrar").toContain("record_deleted");
  });

  it("y la edición dice QUÉ campos cambiaron", () => {
    // «Alguien editó la reserva» no reconstruye nada. Qué campos tocó, sí.
    const src = read("src/app/api/erp/[resource]/[id]/route.ts");
    const i = src.indexOf("record_updated");
    expect(src.slice(i, i + 400)).toMatch(/campos/);
  });
});

describe("el aislamiento del socio no depende del nombre del rol", () => {
  /**
   * Los ficheros que decidían «esto es de un socio» comparando `ctx.role` con
   * la cadena `"partner"`. Están enumerados uno a uno a propósito: una regla
   * que solo dijera «esDeSocio aparece en algún sitio» se cumpliría con que
   * quedara UNA sola llamada, y las otras dieciocho podrían volver al nombre
   * del rol sin que nada se quejara.
   */
  const PUNTOS_DE_AISLAMIENTO = [
    "src/app/api/bookings/[id]/voucher/route.ts",
    "src/app/api/cash/sessions/[id]/arqueo/pdf/route.ts",
    "src/app/api/departures/[id]/manifest/pdf/route.ts",
    "src/app/api/departures/[id]/manifest/route.ts",
    "src/app/api/erp/[resource]/[id]/route.ts",
    "src/app/api/erp/[resource]/route.ts",
    "src/app/api/orders/[id]/schedule/route.ts",
    "src/app/api/orders/route.ts",
    "src/app/api/portal/catalog/route.ts",
    "src/app/api/portal/summary/route.ts",
    "src/app/api/pricing/quote/route.ts",
    "src/app/api/settlements/[id]/statement/pdf/route.ts",
    "src/app/api/storage/upload/route.ts",
    "src/app/dashboard/layout.tsx",
    "src/app/dashboard/mi-espacio/layout.tsx",
    "src/app/page.tsx",
    "src/app/portal/layout.tsx",
    "src/lib/resources.ts",
    "src/lib/row-scope.ts",
    "src/lib/supabase/auth-context.ts",
  ];

  /**
   * Lo que TODAVÍA compara con el nombre del rol, con su motivo y su recuento.
   *
   * El recuento importa tanto como la lista: sin él, un fichero perdonado una
   * vez queda perdonado para siempre y puede ir acumulando comparaciones
   * nuevas debajo de la excepción vieja.
   */
  const COMPARACIONES_PERDONADAS: Record<string, { veces: number; porque: string }> = {
    "src/lib/tenant.ts": {
      veces: 1,
      porque: "es LA definición: esDeSocio() es el único sitio que puede mirar el nombre",
    },
    "src/app/portal/portal-context.tsx": {
      veces: 1,
      porque: "componente de cliente; tenant.ts es `server-only` y no se puede importar aquí",
    },
    "src/app/dashboard/configuracion/page.tsx": {
      veces: 3,
      porque: "es el rol que se ASIGNA en el formulario, no el de quien llama",
    },
  };

  it("cada punto de aislamiento pregunta por esDeSocio", () => {
    /**
     * `esAdminDeSocio` cuenta: está construida sobre `esDeSocio` y pregunta lo
     * mismo con una condición más. Lo que la regla persigue es que la decisión
     * salga del IDENTIFICADOR y no del nombre del rol, y eso se cumple igual —
     * la guarda de abajo, que prohíbe la comparación por nombre, es la que
     * impide que esto se convierta en un coladero.
     */
    const mudos = PUNTOS_DE_AISLAMIENTO.filter((rel) => !/es(?:Admin)?DeSocio\s*\(/.test(sinComentariosDe(rel)));
    expect(mudos, "estos ficheros decidían el aislamiento del socio y ya no preguntan").toEqual([]);
  });

  it("y ninguno de ellos ha vuelto a comparar el nombre del rol", () => {
    const recaidos = PUNTOS_DE_AISLAMIENTO.filter((rel) =>
      /\brole\s*(?:===|!==)\s*"partner"/.test(sinComentariosDe(rel)));
    expect(recaidos, "aquí conviven las dos reglas; la del nombre gana en silencio").toEqual([]);
  });

  it("el barrido de todo src no encuentra comparaciones nuevas por nombre", () => {
    /**
     * La guarda de verdad. Las dos de arriba protegen lo que YA se arregló;
     * esta protege lo que todavía no existe: un fichero nuevo que vuelva a
     * escribir `ctx.role === "partner"` reabre la misma puerta trasera y nadie
     * se acordará de añadirlo a la lista de arriba.
     */
    const encontradas: Record<string, number> = {};
    for (const file of walk(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      const n = (sinComentariosDe(rel).match(/\brole\s*(?:===|!==)\s*"partner"/g) || []).length;
      if (n) encontradas[rel] = n;
    }
    const esperadas = Object.fromEntries(
      Object.entries(COMPARACIONES_PERDONADAS).map(([rel, e]) => [rel, e.veces]));
    expect(encontradas, "compara el rol por su nombre; usa esDeSocio(ctx)").toEqual(esperadas);
  });

  it("esDeSocio se cree el identificador, no solo el rol", () => {
    /**
     * Si la función se quedara en `ctx.role === "partner"` las veinte llamadas
     * de arriba seguirían ahí y no querrían decir nada: la sustitución entera
     * se apoya en que el identificador mande.
     */
    const cuerpo = cuerpoDe("src/lib/tenant.ts");
    const i = cuerpo.indexOf("export function esDeSocio");
    expect(i, "esDeSocio ya no está en tenant.ts").toBeGreaterThan(-1);
    const fn = cuerpo.slice(i, i + 400);
    expect(fn, "una membresía que cuelga de una organización socia").toMatch(/ctx\.isPartnerMember/);
    expect(fn, "un socio asignado directamente").toMatch(/ctx\.partnerId/);
  });

  it("y el identificador se rellena para cualquier rol, no solo para «partner»", () => {
    // Sin esto, `isPartnerMember` sería siempre falso y la regla volvería a
    // depender del nombre por la puerta de atrás.
    const auth = sinComentariosDe("src/lib/supabase/auth-context.ts");
    expect(auth).toMatch(/isPartnerMember:\s*Boolean\(claims\.partner_id\)/);
    expect(sinComentariosDe("src/lib/tenant.ts")).toMatch(/isPartnerMember\??:\s*boolean/);
  });
});

describe("el ciclo de vida del socio", () => {
  it("el estado del socio llega al contexto, y por consulta", () => {
    /**
     * Como dato del token tardaría hasta una hora en surtir efecto: suspender
     * a un tour center que está haciendo algo que no debe no puede esperar a
     * que su sesión se renueve. Mismo razonamiento que la ficha de vendedor.
     */
    const auth = sinComentariosDe("src/lib/supabase/auth-context.ts");
    expect(auth, "el cargador").toMatch(/async function loadPartnerMembership/);
    expect(auth, "se llama al armar el contexto")
      .toMatch(/await loadPartnerMembership\(ctx\.partnerId, user\.id\)/);
    expect(auth, "y su respuesta llega al contexto")
      .toMatch(/ctx\.partnerStatus = membresia\.status/);
    expect(sinComentariosDe("src/lib/tenant.ts")).toMatch(/partnerStatus\?:\s*string \| null/);
  });

  it("y el cargador falla CERRADO", () => {
    /**
     * `loadSellerId` puede devolver null porque null ACOTA. Aquí no: si un
     * fallo de red devolviera «activo», un socio suspendido seguiría operando
     * con solo tirar la consulta. Ninguna rama de este cargador puede producir
     * la cadena `active`.
     */
    const cuerpo = cuerpoDe("src/lib/supabase/auth-context.ts");
    const i = cuerpo.indexOf("async function loadPartnerMembership");
    const fn = cuerpo.slice(i, cuerpo.indexOf("async function loadClaimsFromPrimaryMembership"));
    // Ninguna rama puede producir `active`: ni el error de la consulta, ni la
    // excepción, ni la fila que no está.
    expect(fn, "el cierre").toMatch(/const CERRADO = \{ status: "", partnerRole: null \}/);
    expect(fn, "el error o la fila ausente").toMatch(/if \(error \|\| !data\) return CERRADO/);
    expect(fn, "la excepción").toMatch(/catch \{\s*return CERRADO/);
    expect(fn, "y el estado de la organización, sin inventar").toMatch(/\?\?\s*""/);
  });

  it("el veto se aplica en requireTenant, por donde pasa toda ruta", () => {
    // Comprobado sobre el `throw` y no sobre la llamada: afirmar que
    // `vetoDeSocio` aparece dejaría borrar el lanzamiento y conservar la
    // llamada muerta. Ha mordido tres veces en esta rama.
    const cuerpo = cuerpoDe("src/lib/tenant.ts");
    const i = cuerpo.indexOf("export async function requireTenant");
    const fn = cuerpo.slice(i, cuerpo.indexOf("export async function requireTenantWrite"));
    expect(fn).toMatch(/const veto = vetoDeSocio\(ctx\.partnerStatus\)/);
    expect(fn).toMatch(/if \(veto\)[\s\S]{0,160}throw[\s\S]{0,160}PARTNER_INACTIVE/);
  });

  it("y el portal explica antes de consultar nada", () => {
    /**
     * Una contraseña correcta seguida de un portal que falla en cada recuadro
     * sin decir por qué termina en una llamada a la operadora para reportar
     * una avería que no existe. Y el muro va ANTES de la consulta: pedir datos
     * que no se van a dibujar es trabajo para enseñar un párrafo.
     */
    const layout = cuerpoDe("src/app/portal/layout.tsx");
    expect(layout).toMatch(/if \(veto\) return <SocioSinAcceso/);
    expect(layout.indexOf("SocioSinAcceso"))
      .toBeLessThan(layout.indexOf("tenantQuery"));
  });

  it("la aceptación de condiciones no es un campo más de la ficha", () => {
    /**
     * Si `terms_accepted_*` estuviera en la lista blanca de escritura del CRUD
     * del socio, la operadora podría fechar desde su propia pantalla una firma
     * en nombre del tour center. Una aceptación que el sistema puede fabricar
     * no acredita nada.
     */
    const partners = sinComentariosDe("src/lib/partners.ts");
    const mapa = partners.slice(
      partners.indexOf("PARTNER_RELATIONSHIP_COLUMNS"),
      partners.indexOf("PARTNER_DERIVED_FIELDS"));
    for (const campo of ["terms_version", "terms_accepted_version", "terms_accepted_at", "terms_accepted_by"]) {
      expect(mapa, campo).not.toMatch(new RegExp(campo));
    }
    // Y tampoco por el camino del recurso genérico.
    const recurso = sinComentariosDe("src/lib/resources.ts");
    const bloque = recurso.slice(recurso.indexOf("  partner: {"), recurso.indexOf("  seller: {"));
    expect(bloque.slice(bloque.indexOf("writable"))).not.toMatch(/terms_/);
  });

  it("acepta el socio, y sobre la versión que lee el servidor", () => {
    const ruta = sinComentariosDe("src/app/api/portal/terms/route.ts");
    // El personal interno entra al portal a auditar lo que el socio ve; desde
    // ahí, aceptar sería firmar en nombre de otra empresa.
    expect(ruta, "solo el socio").toMatch(/if \(!esDeSocio\(ctx\) \|\| !ctx\.partnerId\)[\s\S]{0,120}throw/);
    // La versión sale de la fila, nunca del cuerpo: si viniera en la petición,
    // un socio podría firmar una versión que ya no rige, o una que nadie ha
    // publicado todavía.
    expect(ruta, "la versión firmada").toMatch(/terms_accepted_version:\s*rel\.terms_version/);
    expect(ruta, "quién firmó").toMatch(/terms_accepted_by:\s*ctx\.userId/);
    expect(ruta, "no lee el cuerpo").not.toMatch(/req\.json\(\)/);
  });

  it("la migración 0073 exige rol de socio si y solo si organización de socio", () => {
    /**
     * Las dos mitades, y la segunda no estaba cerrada en ningún sitio del
     * servidor: un rol `partner` sobre la operadora sale SIN identificador de
     * socio, y «sin identificador» es lo que `app.can_read_partner` entiende
     * por «ve todo».
     */
    const sql = read("supabase/migrations/0073_partner_lifecycle.sql");
    expect(sql, "empleado de socio con otro rol")
      .toMatch(/org_kind = 'partner' and new\.role <> 'partner'/);
    expect(sql, "rol de socio sin socio")
      .toMatch(/org_kind is distinct from 'partner' and new\.role = 'partner'/);
    expect(sql, "y el disparador existe")
      .toMatch(/create trigger memberships_role_matches_org/);
    // Lee `organizations`, que tiene RLS: sin `definer`, `kind` sale nulo para
    // quien no puede leer esa fila y el cerrojo no salta nunca.
    expect(sql, "security definer").toMatch(/security definer/);
  });

  it("y el servidor exige la misma equivalencia al dar de alta", () => {
    const cuerpo = cuerpoDe("src/lib/team-invite.ts");
    const i = cuerpo.indexOf("export async function resolveMembershipOrg");
    const fn = cuerpo.slice(i, i + 1400);
    expect(fn, "rol de socio sin tour center").toMatch(/rolePedido === "partner"[\s\S]{0,200}throw/);
    expect(fn, "y el cerrojo de siempre").toMatch(/role: "partner", esSocio: true/);
  });
});

describe("el socio gestiona a su propia gente, y solo a la suya", () => {
  it("las tres operaciones del equipo salen del mismo ámbito", () => {
    /**
     * Ni una sola comprueba el rol por su cuenta. Es la diferencia entre una
     * regla y tres copias de una regla: la de listar ya se le escapó una vez
     * —los usuarios de tour center no salían— y la de editar los dejaba fuera
     * de toda edición con un «usuario no encontrado» delante de la persona.
     */
    const ruta = cuerpoDe("src/app/api/team/route.ts");
    expect(ruta, "listar").toMatch(/const ambito = ambitoDeLectura\(ctx\)/);
    expect((ruta.match(/const ambito = ambitoDeEscritura\(ctx\)/g) || []).length,
      "dar de alta y editar").toBe(2);
    // Y el rango ya no se comprueba aquí: lo decide el ámbito.
    expect(ruta, "el rango se decide en el ámbito").not.toMatch(/requireAtLeast\(ctx,/);
  });

  it("el ámbito se usa como FILTRO, no como comprobación previa", () => {
    /**
     * Es la propiedad que hace que no se pueda olvidar. Un permiso booleano se
     * comprueba arriba y luego la consulta va sin acotar; un permiso que
     * devuelve el conjunto de organizaciones tiene que entrar en la consulta
     * para que ésta compile.
     */
    const ruta = cuerpoDe("src/app/api/team/route.ts");
    expect((ruta.match(/orgIds = \[ambito\.organizationId\]/g) || []).length,
      "listar y editar acotan por el ámbito").toBe(2);
    /**
     * LAS DOS, contadas. Pedir que la expresión aparezca «alguna vez» dejaba
     * volver a `ctx.companyId` en una de ellas y pasar por la otra: la mutación
     * que devolvía el listado a la operadora no mordía.
     */
    expect((ruta.match(/\.in\("organization_id", orgIds\)/g) || []).length,
      "el listado y la edición buscan en ese conjunto").toBe(2);
    // Y ninguna vuelve a buscar membresías por la empresa del contexto, que es
    // exactamente lo que dejaba a los usuarios de tour center sin edición.
    expect(ruta.slice(ruta.indexOf("organization_memberships")),
      "una membresía no se busca por ctx.companyId")
      .not.toMatch(/\.eq\("organization_id", ctx\.companyId\)/);
  });

  it("el socio no elige ni el rol ni la organización de destino", () => {
    const ruta = cuerpoDe("src/app/api/team/route.ts");
    // El rol es el único que puede haber sobre su organización (0073), y la
    // organización es la suya: pasarle `body.partner_id` dejaría que el
    // administrador de un tour center diera de alta gente en otro de la red.
    expect(ruta).toMatch(/ambito\.esSocio \? \("partner" as AppRole\) : assertRole\(ctx,/);
    expect(ruta).toMatch(/ambito\.esSocio\s*\n?\s*\? \{ organizationId: ambito\.organizationId!/);
  });

  it("y no puede dejar su empresa sin nadie que la administre", () => {
    // Bajarse a agente y desactivarse son el mismo agujero por dos caminos; la
    // cuenta se hace ANTES de escribir.
    const ruta = cuerpoDe("src/app/api/team/route.ts");
    const i = ruta.indexOf("assertNoSeQuedaSinAdmin({");
    expect(i, "la comprobación no está").toBeGreaterThan(-1);
    expect(i).toBeLessThan(ruta.indexOf('.from("organization_memberships")\n        .update(patch)'));
  });

  it("la jerarquía del socio no se cuela en las membresías internas", () => {
    /**
     * `partner_role = 'admin'` colgando de la operadora sería un campo con
     * valor que hoy nadie lee, esperando a que alguien lo lea algún día. Lo
     * impide la aplicación y lo vuelve a impedir el disparador.
     */
    expect(cuerpoDe("src/app/api/team/route.ts"))
      .toMatch(/destino\.esSocio \? partnerRole : null/);
    expect(read("supabase/migrations/0074_partner_self_service.sql"))
      .toMatch(/else\s*\n\s*new\.partner_role := null;/);
  });

  it("y el disparador escucha los cambios de esa columna", () => {
    // Sin añadirla a la lista de columnas del disparador, subir a alguien a
    // administrador no pasaría por la coherencia.
    expect(read("supabase/migrations/0074_partner_self_service.sql"))
      .toMatch(/before insert or update of role, organization_id, partner_role/);
  });

  it("el relleno deja un administrador por socio, y solo uno", () => {
    /**
     * Sin relleno, la función nace apagada para todos los tour centers que ya
     * existen. Con todos de administrador, un becario da de alta a quien quiera
     * el primer día — y eso no se deshace.
     */
    const sql = read("supabase/migrations/0074_partner_self_service.sql");
    expect(sql, "el más antiguo de cada socio").toMatch(/distinct on \(m\.organization_id\)[\s\S]{0,200}order by m\.organization_id, m\.created_at asc/);
    expect(sql, "y el resto, agente").toMatch(/else 'agent' end/);
  });
});

describe("un solo punto de entrada de ámbito por fila", () => {
  it("nadie compone los dos ámbitos por su cuenta", () => {
    /**
     * `partnerScopeFor` y `sellerFilterFor` siguen siendo las reglas de cada
     * actor; lo que no puede volver a haber es dos sitios que las combinen,
     * porque es donde se cuela la diferencia. Las rutas que arman su propio
     * filtro sobre UNA sola tabla (`/api/orders`, `/api/quotes`) siguen
     * pidiendo la del vendedor directamente: no componen nada.
     */
    const componen: string[] = [];
    for (const file of walk(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (rel === "src/lib/row-scope.ts") continue;
      const src = sinComentariosDe(rel);
      if (/partnerScopeFor\s*\(/.test(src) && /sellerFilterFor\s*\(|sellerCanReadRow\s*\(/.test(src)) {
        componen.push(rel);
      }
    }
    expect(componen, "aquí se vuelven a combinar los dos ámbitos").toEqual([]);
  });

  it("y el detalle usa la misma composición que el listado", () => {
    // Dos guardas gemelas en el detalle, una debajo de la otra, cada una
    // diciendo en su comentario que era la pareja de la otra: ésa era la señal.
    const detalle = sinComentariosDe("src/app/api/erp/[resource]/[id]/route.ts");
    expect(detalle, "ya no tiene guardas propias").not.toMatch(/function assertPartnerCanRead/);
    expect(detalle).not.toMatch(/function assertSellerCanRead/);
    expect(detalle).toMatch(/assertRowInScope\(/);
  });

  it("el ámbito del socio entra por `_and`, no pisando el filtro del usuario", () => {
    /**
     * Antes se escribía `filter[scope.field] = scope.partnerId` sobre el filtro
     * base, así que SUSTITUÍA lo que hubiera pedido quien consulta en vez de
     * sumarse. Funcionaba porque sustituía por algo más restrictivo, pero es
     * una propiedad que depende del orden de dos asignaciones; por `_and` se
     * cumplen los dos filtros y ya no depende de nada.
     */
    expect(sinComentariosDe("src/lib/row-scope.ts"))
      .toMatch(/filtros\.push\(\{ \[scope\.field\]: scope\.partnerId \}\)/);
  });

  it("el plan cuenta también a la gente de los tour centers", () => {
    /**
     * La membresía de un usuario de portal cuelga de la organización del SOCIO.
     * Contando solo la raíz, ninguno figuraba: una operadora con cinco
     * empleados y cuarenta personas en sus tour centers aparecía con cinco. Con
     * el socio dándose de alta a sí mismo, eso deja de ser una imprecisión y
     * pasa a ser un plan que no limita nada.
     */
    const plan = cuerpoDe("src/lib/plan-service.ts");
    expect(plan, "el conjunto de organizaciones").toMatch(/async function orgsDeLaOperadora/);
    expect(plan, "y el recuento lo usa").toMatch(/\.in\("organization_id", orgIds\)\.in\("status"/);
    expect(plan, "ya no cuenta solo la raíz")
      .not.toMatch(/organization_memberships"\)[\s\S]{0,120}\.eq\("organization_id", companyId\)/);
  });

  it("y ese conteo falla contando de MENOS, nunca de más", () => {
    // Cobrar de más por una consulta que se cayó es peor que cobrar de menos.
    const plan = cuerpoDe("src/lib/plan-service.ts");
    const i = plan.indexOf("async function orgsDeLaOperadora");
    const fn = plan.slice(i, plan.indexOf("export async function loadUsage"));
    expect(fn, "el error de la consulta").toMatch(/if \(error\) return \[companyId\]/);
    expect(fn, "la excepción").toMatch(/catch \{\s*return \[companyId\]/);
  });

  it("hay con qué medir antes de desplegarlo", () => {
    /**
     * El arreglo mueve operadoras de «dentro de su plan» a «por encima» sin que
     * hayan hecho nada, y lo descubrirían al recibir un 402 al dar de alta a
     * alguien. La consulta dice cuáles y por cuánto, para hablar con ellas
     * antes; el plan del ecosistema lo pedía con esas palabras.
     */
    const sql = read("supabase/editor/medir_usuarios_antes_de_activar_el_conteo.sql");
    // Sin sus comentarios: este fichero EXPLICA que la raíz se apunta a sí
    // misma con un `update`, y la palabra en una explicación no es una
    // escritura. La misma trampa que ya obligó a `sinComentariosDe`.
    const soloSql = sql.replace(/^\s*--.*$/gm, "");
    expect(soloSql, "no cambia nada").not.toMatch(/\b(update|insert|alter|delete|create)\b/i);
    expect(sql, "compara el antes y el después")
      .toMatch(/usuarios_contados_antes[\s\S]*usuarios_contados_ahora/);
    expect(sql, "y señala a quién avisar").toMatch(/SE PASA AL DESPLEGAR/);
  });
});

describe("el vendedor del tour center", () => {
  it("la tabla de vendedores entra como PROPIA del socio, no como compartida", () => {
    /**
     * EL CUIDADO ESPECÍFICO DEL PLAN, Y POR QUÉ SE COMPRUEBA ASÍ.
     *
     * «Compartida» significa, literalmente, sin filtro de socio. Con `seller`
     * ahí, el tour center leería las fichas INTERNAS de la operadora con la
     * comisión, la meta y el techo de descuento de cada vendedor propio. Es la
     * lista a la que se añade por costumbre lo que el socio «solo consulta».
     */
    const recursos = sinComentariosDe("src/lib/resources.ts");
    const propias = recursos.slice(
      recursos.indexOf("const PARTNER_OWNED_TABLES"),
      recursos.indexOf("const PARTNER_SHARED_TABLES"));
    const compartidas = recursos.slice(
      recursos.indexOf("const PARTNER_SHARED_TABLES"),
      recursos.indexOf("export type PartnerScope"));
    expect(propias, "propia").toMatch(/"seller"/);
    expect(compartidas, "y nunca compartida").not.toMatch(/"seller"/);
  });

  it("las cuatro tablas sin columna de socio están denegadas Y escrito por qué", () => {
    /**
     * `partnerScopeFor` deniega por defecto, así que la lista no cambia nada:
     * existe para que la decisión esté tomada por escrito. El plan pedía
     * decidirlo «de antemano» porque es donde la respuesta fácil —añadirlas
     * cuando alguien las pida— es la equivocada: no tienen dimensión de socio,
     * y un filtro por vendedor a secas le enseñaría al agente de un tour
     * center las metas de los vendedores internos.
     */
    const recursos = sinComentariosDe("src/lib/resources.ts");
    const declaradas = recursos.slice(recursos.indexOf("PARTNER_DENEGADAS_A_PROPOSITO"));
    for (const tabla of ["seller_goal", "seller_bonus", "seller_link", "seller_attribution"]) {
      expect(declaradas, tabla).toMatch(new RegExp(`${tabla}:`));
      // Y ninguna se ha colado en las que sí ve.
      expect(recursos.slice(
        recursos.indexOf("const PARTNER_OWNED_TABLES"),
        recursos.indexOf("export type PartnerScope")), tabla).not.toMatch(new RegExp(`"${tabla}"`));
    }
  });

  it("el ámbito del vendedor recibe al actor entero, no cuatro cadenas sueltas", () => {
    /**
     * Con `(table, role, sellerId, rowSellerId)` eran cuatro argumentos del
     * mismo tipo en fila — el sitio donde se cuela un intercambio de dos que
     * compila y no se nota hasta que alguien lee lo que no debía. Y con el
     * vendedor del tour center harían falta dos más.
     */
    const ambito = sinComentariosDe("src/lib/seller-scope.ts");
    expect(ambito).toMatch(/export interface ActorVendedor/);
    expect(ambito, "el filtro").toMatch(/sellerFilterFor\(\s*table: string,\s*actor: ActorVendedor/);
    expect(ambito, "y la fila").toMatch(/sellerCanReadRow\(\s*table: string,\s*actor: ActorVendedor/);
  });

  it("y decide por la ficha cuando quien llama viene de un socio", () => {
    // La asimetría documentada: dentro de la operadora lo dice el rol; dentro
    // de un tour center, la ficha. Comprobado sobre el `return`, no sobre que
    // la función se mencione.
    const cuerpo = cuerpoDe("src/lib/seller-scope.ts");
    const i = cuerpo.indexOf("export function sellerScopeApplies");
    const fn = cuerpo.slice(i, cuerpo.indexOf("export function sellerFilterFor"));
    expect(fn).toMatch(/if \(esDeSocio\(actor\)\) return !esAdminDeSocio\(actor\) && Boolean\(actor\.sellerId\)/);
    expect(fn).toMatch(/return actor\.role === "seller"/);
  });
});

describe("el vendedor de una venta es de quien la vende", () => {
  it("la venta comprueba la coherencia ANTES de escribir nada", () => {
    /**
     * Rechazar tarde obliga a compensar escrituras que no había que haber
     * hecho: plazas tomadas, cupo consumido, crédito apuntado. Por eso va con
     * el vendedor ya resuelto y antes del primer bloque que reserva algo.
     */
    const servicio = cuerpoDe("src/lib/booking-service.ts");
    const i = servicio.indexOf("desajusteDeAtribucion(");
    expect(i, "la comprobación no está").toBeGreaterThan(-1);
    // Sobre el `throw`, no sobre la llamada: afirmar que la función aparece
    // deja borrar el lanzamiento y conservar la llamada muerta.
    expect(servicio.slice(i, i + 220)).toMatch(/if \(desajuste\) throw[\s\S]{0,80}status: 400/);
    // Anclado en CÓDIGO y no en el texto de un comentario: `cuerpoDe` los
    // quita, y una guarda de orden que se apoya en un comentario mide el orden
    // de dos cosas que no existen.
    expect(i, "antes de tomar plazas").toBeLessThan(servicio.indexOf("assertCapacity("));
    expect(i, "antes de consumir cupo").toBeLessThan(servicio.indexOf("assertAllotment("));
    expect(i, "y antes del límite de crédito").toBeLessThan(servicio.indexOf("creditCheck("));
  });

  it("y solo cuesta una consulta cuando hay vendedor", () => {
    /**
     * La venta directa es la mitad de las que se registran: no puede pagar una
     * consulta por una comprobación que no le aplica.
     *
     * Se mira el trozo QUE PRECEDE a la comprobación y no el fichero entero:
     * `if (attributedSeller)` aparece dos veces —la otra apunta el embudo de
     * atribución al final—, así que buscarlo suelto lo daba por bueno aunque
     * se hubiera borrado el de aquí. No mordía; ahora sí.
     */
    const servicio = cuerpoDe("src/lib/booking-service.ts");
    const i = servicio.indexOf("desajusteDeAtribucion(");
    expect(servicio.slice(Math.max(0, i - 400), i)).toMatch(/if \(attributedSeller\) \{/);
  });

  it("el punto de venta no ofrece lo que la API va a rechazar", () => {
    /**
     * Los dos desplegables eran independientes y se mandaban tal cual. Estrechar
     * la pantalla no cierra nada por sí solo —los identificadores viajan en el
     * cuerpo—, pero ofrecer una opción que el servidor rechaza es peor que no
     * ofrecerla: el error aparece al final, con el carrito lleno.
     */
    const contexto = sinComentariosDe("src/app/api/pos/context/route.ts");
    expect(contexto, "de qué socio es cada ficha").toMatch(/partner: refId\(s\.partner\) \?\? null/);

    const pos = sinComentariosDe("src/app/dashboard/pos/page.tsx");
    expect(pos, "la lista se acota").toMatch(/todos\.filter\(\(s\) => !s\.partner \|\| s\.partner === partnerId\)/);
    // Y el desplegable usa la lista acotada, no la cruda: sin esto el filtro
    // existiría y no lo miraría nadie.
    expect(pos, "y el desplegable la usa").toMatch(/\{vendedoresDisponibles\.map\(/);
    // Al cambiar de socio, el vendedor que deja de encajar se suelta. Sin esto
    // queda un identificador seleccionado que el desplegable ya no enseña.
    expect(pos, "y se suelta al cambiar de socio")
      .toMatch(/if \(!vendedoresDisponibles\.some\(\(s\) => s\._id === sellerId\)\) setSellerId\(""\)/);
  });
});

describe("/portal/vendedores", () => {
  it("es de quien dirige, no de quien vende", () => {
    /**
     * Enseña lo que vendió cada compañero: justo lo que el ámbito del vendedor
     * existe para que un agente no vea. Y aquí ese ámbito no se aplica solo,
     * porque la consulta pide las órdenes de una LISTA de vendedores y no pasa
     * por el armador de filtros. La puerta se cierra a la entrada.
     */
    const ruta = cuerpoDe("src/app/api/portal/sellers/route.ts");
    expect(ruta).toMatch(/if \(!esAdminDeSocio\(ctx\)\) \{[\s\S]{0,260}throw new TenantError/);
    expect(ruta, "y desde la operadora, gerencia").toMatch(/requireAtLeast\(ctx, "manager"\)/);
  });

  it("sin equipo no consulta nada, en vez de preguntar por una lista vacía", () => {
    /**
     * `in: []` no significa «ninguno» en todos los traductores de consulta: en
     * algunos es una condición que no se aplica, y entonces esta pantalla
     * enseñaría las ventas de la operadora entera. No se le da la ocasión.
     */
    expect(cuerpoDe("src/app/api/portal/sellers/route.ts"))
      .toMatch(/ids\.length\s*\?[\s\S]{0,900}:\s*\[\[\], \[\]\]/);
  });

  it("y no rehace el aislamiento por su cuenta", () => {
    // El ámbito del socio ya acota `seller` —es tabla propia desde 5.1— y el
    // recorte de columnas es el mismo módulo que usa el listado genérico. Una
    // ruta a medida que rehace el aislamiento es una que un día lo hará mal.
    const ruta = cuerpoDe("src/app/api/portal/sellers/route.ts");
    expect(ruta).toMatch(/projectRows\("seller", ctx,/);
    expect(ruta, "no arma su propio ámbito de socio").not.toMatch(/partnerScopeFor|PARTNER_OWNED/);
  });
});

describe("la cartera propia del tour center", () => {
  it("`customer` entra como PROPIA del socio, no como compartida", () => {
    /**
     * Sin `customer` en su ámbito el socio no podía terminar una venta —la
     * orden exige cliente—. Con él compartido habría visto la cartera ENTERA
     * de la operadora: nombres, teléfonos y correos, a la vista de sus
     * revendedores. Es la misma trampa que con `seller`, con datos personales
     * de terceros dentro.
     */
    const recursos = sinComentariosDe("src/lib/resources.ts");
    const propias = recursos.slice(
      recursos.indexOf("const PARTNER_OWNED_TABLES"),
      recursos.indexOf("const PARTNER_SHARED_TABLES"));
    const compartidas = recursos.slice(
      recursos.indexOf("const PARTNER_SHARED_TABLES"),
      recursos.indexOf("export type PartnerScope"));
    expect(propias, "propia").toMatch(/"customer"/);
    expect(compartidas, "y nunca compartida").not.toMatch(/"customer"/);
  });

  /**
   * El bloque del recurso `customer`, delimitado por su `table`.
   *
   * `"  customer: {"` a secas no vale: esa misma cadena aparece antes dentro de
   * las expansiones de otros recursos, así que el corte salía de un sitio que
   * no era y una comprobación de «esto NO aparece» pasaba por mirar donde no
   * había nada. Un `not.toMatch` sobre el trozo equivocado siempre pasa.
   */
  const bloqueDeCliente = () => {
    const recursos = sinComentariosDe("src/lib/resources.ts");
    const i = recursos.indexOf('customer: {\n    table: "customer"');
    expect(i, "no se encontró el recurso customer").toBeGreaterThan(-1);
    return recursos.slice(i, recursos.indexOf('lead: {\n    table: "lead"'));
  };

  it("y de quién es un cliente no se escribe desde el formulario", () => {
    // Con `partner` en la lista blanca, un tour center daría de alta clientes
    // a nombre de otro —o de la operadora— y se los quitaría de la cartera.
    const bloque = bloqueDeCliente();
    expect(bloque.slice(bloque.indexOf("writable"))).not.toMatch(/"partner"/);
  });

  it("el alta del portal sella el socio desde el contexto", () => {
    const ruta = cuerpoDe("src/app/api/portal/customers/route.ts");
    expect(ruta, "solo el socio").toMatch(/if \(!esDeSocio\(ctx\) \|\| !ctx\.partnerId\)[\s\S]{0,120}throw/);
    expect(ruta, "el sello").toMatch(/payload\.partner_id = ctx\.partnerId/);
    // Y por lista blanca: el cuerpo no puede traer campos que nadie declaró.
    expect(ruta, "lista blanca").toMatch(/for \(const campo of CAMPOS\)/);
    expect(ruta, "y no se copia el cuerpo entero").not.toMatch(/\.\.\.body/);
  });

  it("el socio ve la ficha del cliente, no su historial con la operadora", () => {
    /**
     * `customer.expandOne` arrastra órdenes, reservas y oportunidades: todo lo
     * que esa persona le ha comprado nunca a la operadora, incluido lo que
     * compró por otro canal. Y apoyarse en que la RLS filtre esas expansiones
     * no vale — la capa de datos habla por el rol de servicio cuando la RLS
     * está apagada, y entonces no filtra nadie.
     */
    expect(bloqueDeCliente()).toMatch(/expandOnePartner: \{ hotel: true \}/);
    const detalle = cuerpoDe("src/app/api/erp/[resource]/[id]/route.ts");
    expect(detalle).toMatch(/\(esDeSocio\(ctx\) && def\.expandOnePartner\)/);
  });

  it("la migración 0075 pone la política en la MISMA entrega", () => {
    /**
     * El riesgo transversal del plan: cada tabla que se abre a un actor nuevo
     * necesita su política en la misma fase. Aquí es más fuerte todavía — sin
     * ella la aplicación filtraría por socio y la BASE diría que ese socio
     * puede leer la cartera entera, y una política que contradice a la
     * aplicación es la que alguien cita cuando se discute qué pasó.
     *
     * `seller` va en el mismo saco: 5.1 la abrió al socio en la aplicación y
     * dejó la política como estaba. Se salda aquí.
     */
    const sql = read("supabase/migrations/0075_partner_customers.sql");
    expect(sql, "la columna").toMatch(/add column if not exists partner_id/);
    expect(sql, "las dos tablas").toMatch(/array\['customer', 'seller'\]/);
    expect(sql, "y la política por socio").toMatch(/app\.can_read_partner\(partner_id\)/);
  });

  it("y el relleno no se inventa dueños", () => {
    /**
     * Sin relleno, la política le esconde al socio los clientes de sus PROPIAS
     * reservas: hoy ve el nombre en cada una y mañana vería un hueco. Con un
     * relleno ambicioso le regalaría clientes que también compraron por otro
     * canal. Solo cuando no hay ninguna duda.
     */
    const sql = read("supabase/migrations/0075_partner_customers.sql");
    expect(sql, "un único socio").toMatch(/having count\(distinct o\.partner_id\) = 1/);
    expect(sql, "y ninguna compra directa")
      .toMatch(/count\(\*\) filter \(where o\.partner_id is null\) = 0/);
    // Y no se filtran las órdenes sin socio en el `where`: filtrarlas sacaría
    // del grupo justo las que hacen ambiguo el caso.
    const cte = sql.slice(sql.indexOf("with unico as"), sql.indexOf("group by o.customer_id"));
    expect(cte, "el where no esconde las directas").not.toMatch(/and o\.partner_id is not null/);
  });
});

describe("el portal deja de ser solo lectura", () => {
  it("la pantalla no decide precio, cupo ni crédito", () => {
    /**
     * Las tres cosas vienen del servidor: el neto del motor de precios con el
     * canal `b2b_portal`, las plazas del catálogo, y el crédito lo vuelve a
     * comprobar la venta con los documentos abiertos al escribir. Lo que se
     * pinta es un espejo — uno que decidiera por su cuenta sería la segunda
     * verdad que se desincroniza sola, y aquí eso es prometerle una plaza a un
     * cliente que ya no existe.
     */
    const pantalla = sinComentariosDe("src/app/portal/reservar/page.tsx");
    expect(pantalla, "el precio sale del catálogo").toMatch(/p\.price\?\.unit_price \?\? 0/);
    expect(pantalla, "no hay tarifa escrita a mano").not.toMatch(/resolvePrice|price_rule|margin/);
    // El total es una suma de lo que mandó el servidor, no una fórmula con
    // descuentos ni comisiones inventadas en el navegador.
    expect(pantalla).toMatch(/l\.unit_price \* \(l\.adults \+ l\.children\)/);
  });

  it("y no manda el socio en el cuerpo de la venta", () => {
    /**
     * Lo pone el servidor desde el contexto. Mandarlo daría la impresión de que
     * la pantalla lo decide, y el día que alguien cambiara ese valor en la
     * petición se descubriría que no servía de nada — o, peor, que sí.
     */
    const pantalla = sinComentariosDe("src/app/portal/reservar/page.tsx");
    const envio = pantalla.slice(pantalla.indexOf('api.post<{ order'), pantalla.indexOf("setConfirmando(false)"));
    expect(envio).not.toMatch(/partner_id/);
    // Ni el precio: un `unit_price_override` desde el portal sería «pon tú el
    // precio». La ruta lo borra igual; esto es para que no se intente.
    expect(envio).not.toMatch(/unit_price|override/);
  });

  it("el crédito que se enseña se llama estimación y no bloquea", () => {
    // El saldo vivo cambia con cada cobro y quien decide es el servidor al
    // escribir. Un veto aquí haría que el socio dejara de vender por un número
    // viejo; el aviso le dice dónde está sin decidir por él.
    const pantalla = cuerpoDe("src/app/portal/reservar/page.tsx");
    expect(pantalla, "se calcula el exceso").toMatch(/Math\.max\(total - credito\.credit_available, 0\)/);
    // Y el botón de confirmar no lo mira.
    const boton = pantalla.slice(pantalla.indexOf("disabled={confirmando"));
    expect(boton.slice(0, 120)).not.toMatch(/exceso/);
  });

  it("y la venta del socio sigue sin poder saltarse su crédito", () => {
    // Estaba desde antes y es lo que hace que el aviso de arriba pueda ser solo
    // un aviso. Se sujeta aquí para que no se caiga al abrir el portal a vender.
    expect(cuerpoDe("src/app/api/orders/route.ts"))
      .toMatch(/if \(esDeSocio\(ctx\)\) delete body\.allow_over_credit/);
    expect(cuerpoDe("src/app/api/orders/route.ts"))
      .toMatch(/if \(esDeSocio\(ctx\) && ctx\.partnerId\) body\.partner_id = ctx\.partnerId/);
  });
});

describe("el voucher que entrega el tour center", () => {
  it("sale con la marca del socio y SIN el neto", () => {
    /**
     * `booking.total_amount` de una venta B2B es lo que el tour center le paga
     * a la operadora, no lo que el turista pagó en el mostrador. Imprimirlo le
     * enseña al cliente el margen de quien se lo acaba de vender, en el papel
     * que ese mismo vendedor le está poniendo en la mano.
     */
    const ruta = cuerpoDe("src/app/api/bookings/[id]/voucher/route.ts");
    expect(ruta, "la marca").toMatch(/brand_override: brandingDeSocio\(socio, ctx\.company\)/);
    expect(ruta, "y el neto fuera").toMatch(/hide_amounts: Boolean\(socio\)/);
  });

  it("y la condición es de la RESERVA, no de quién la descarga", () => {
    /**
     * El mismo PDF lo puede bajar la operadora y reenviárselo, o salir por el
     * correo automático. Acabe como acabe, el papel termina en la mano del
     * turista. Con `esDeSocio(ctx)` el neto se escaparía por los otros dos
     * caminos sin que nadie lo notara.
     */
    const ruta = cuerpoDe("src/app/api/bookings/[id]/voucher/route.ts");
    const i = ruta.indexOf("hide_amounts:");
    expect(ruta.slice(i, i + 60)).not.toMatch(/esDeSocio/);
    expect(ruta).toMatch(/const socio = expanded\(booking\.partner\)/);
  });

  it("el importe no se pone a cero: el bloque entero desaparece", () => {
    // Un total en cero dice «esto no costó nada», que es otra afirmación falsa.
    const doc = cuerpoDe("src/lib/pdf/documents.ts");
    const i = doc.indexOf("if (data.hide_amounts) {");
    expect(i, "no está la rama").toBeGreaterThan(-1);
    const rama = doc.slice(i, doc.indexOf("} else {", i));
    expect(rama, "no imprime importes").not.toMatch(/formatMoney/);
    expect(rama, "pero sí dice algo").toMatch(/pdf\.notice/);
  });

  it("la identidad es del socio y las condiciones de la operadora", () => {
    /**
     * Al revés produciría un documento que promete en nombre de quien no puede
     * cumplir. Y la ficha del socio no tiene condiciones, así que sin esto el
     * voucher del tour center saldría sin letra pequeña justo en el caso en que
     * más falta hace.
     */
    const doc = cuerpoDe("src/lib/pdf/documents.ts");
    expect(doc).toMatch(/terms: documentBrand\(company, "voucher"\)\.terms/);
    const marca = cuerpoDe("src/lib/branding.ts");
    const i = marca.indexOf("export function brandingDeSocio");
    const fn = marca.slice(i, marca.indexOf("export function brandingGaps"));
    expect(fn, "el pie es de la operadora").toMatch(/document_footer: operadora\?\.document_footer/);
    expect(fn, "y sin nombre no se sustituye nada").toMatch(/if \(!nombre\) return null/);
  });
});

describe("la disputa de una liquidación", () => {
  it("la abre el beneficiario, con la comprobación que ya existía", () => {
    /**
     * Su propio comentario anticipaba esta ruta: «lo hacen tres caminos —la
     * pantalla, el PDF y, más adelante, la disputa—». Una cuarta copia de la
     * misma pregunta es la que un día dice algo distinto.
     */
    const ruta = cuerpoDe("src/app/api/settlements/[id]/dispute/route.ts");
    expect(ruta).toMatch(/assertSettlementBeneficiary\(ctx, settlement\)/);
    expect(ruta, "no se reescribe el ámbito").not.toMatch(/beneficiary_type|ctx\.partnerId ===/);
  });

  it("el destinatario se GUARDA, no solo se avisa", () => {
    /**
     * Guardarlo es lo que permite que la pantalla diga quién la está mirando y
     * que la operadora la reasigne. Un aviso enviado y no registrado deja la
     * disputa sin dueño en cuanto alguien lo marca como leído.
     */
    const ruta = cuerpoDe("src/app/api/settlements/[id]/dispute/route.ts");
    expect(ruta).toMatch(/dispute_assignee: destinatario/);
    expect(ruta, "y el aviso va a esa persona").toMatch(/userId: destinatario \?\? undefined/);
    // Y la respuesta dice si hay alguien: el caso sin destinatario hay que
    // evitarlo, no disimularlo.
    expect(ruta).toMatch(/dispute_assigned: Boolean\(destinatario\)/);
  });

  it("y la pantalla lo dice cuando no hay nadie asignado", () => {
    // Dejar al tour center creyendo que alguien la está mirando es peor que
    // decirle que insista.
    expect(sinComentariosDe("src/app/portal/liquidaciones/page.tsx"))
      .toMatch(/dispute_assigned[\s\S]{0,200}insiste/);
  });

  it("una liquidación PAGADA se puede disputar", () => {
    // «Me pagaste menos de lo acordado» solo se descubre cobrando: cerrarlo al
    // pagar convertiría el pago en un finiquito unilateral.
    const regla = sinComentariosDe("src/lib/disputa.ts");
    const cerrados = regla.slice(regla.indexOf("const CERRADOS"), regla.indexOf("export interface VetoDisputa"));
    expect(cerrados).not.toMatch(/paid/);
    expect(cerrados, "anulada y ya disputada, no").toMatch(/void:[\s\S]*disputed:/);
  });

  it("y la CRUD genérica sigue sin poder tocar el estado", () => {
    // La disputa cambia `status`, y ése no está en la lista blanca de nadie:
    // pagar y disputar pasan por sus rutas, que hacen lo demás.
    const recursos = sinComentariosDe("src/lib/resources.ts");
    const bloque = recursos.slice(
      recursos.indexOf('settlement: {\n    table: "settlement"'),
      recursos.indexOf('payable: {\n    table: "payable"'));
    expect(bloque).toMatch(/writable: \["notes"\]/);
  });
});

describe("la exportación del socio", () => {
  it("falla por OMISIÓN: sin lista declarada, no exporta", () => {
    /**
     * Es toda la gracia de la regla. `exportColumns` arma las cabeceras con las
     * claves que TRAEN las filas —lo correcto para el ERP interno, donde quien
     * exporta quiere todo lo suyo— y eso convierte cada columna nueva de cada
     * tabla en una fuga silenciosa hacia el archivo de un actor externo.
     *
     * Comprobado sobre el `throw` y no sobre la llamada, que ya ha mordido
     * varias veces en esta rama.
     */
    const ruta = cuerpoDe("src/app/api/export/[resource]/route.ts");
    expect(ruta).toMatch(/const columnasDelSocio = esDeSocio\(ctx\) \? columnasParaSocio\(resource\) : null/);
    expect(ruta).toMatch(/if \(esDeSocio\(ctx\) && !columnasDelSocio\) \{[\s\S]{0,260}throw new TenantError/);
    // Y la lista llega al exportador: comprobar que se calcula y no usarla
    // sería la forma más silenciosa de que esto no hiciera nada.
    expect(ruta).toMatch(/fields: columnasDelSocio \?\? undefined/);
  });

  it("y el ERP interno sigue exportando todo lo suyo", () => {
    // La regla es para el actor externo. Aplicarla dentro rompería la promesa
    // de «llévate tus datos», que es de lo que trata esa pantalla.
    const ruta = cuerpoDe("src/app/api/export/[resource]/route.ts");
    expect(ruta).toMatch(/esDeSocio\(ctx\) \? columnasParaSocio/);
  });

  it("la lista blanca manda sobre las claves de los datos", () => {
    /**
     * Y ANTES de recorrer las filas, no filtrando el resultado: así el orden es
     * el declarado y no el que traigan los datos, que cambia entre dos
     * exportaciones del mismo listado según qué fila venga primero con qué
     * campos rellenos. Un archivo cuyas columnas bailan no se compara con el
     * del mes pasado.
     */
    const exportador = cuerpoDe("src/lib/export.ts");
    const i = exportador.indexOf("if (options.fields) {");
    expect(i, "no está la rama de lista blanca").toBeGreaterThan(-1);
    expect(i, "va antes de deducir columnas de las filas")
      .toBeLessThan(exportador.indexOf("const seen: string[] = []"));
    expect(exportador.slice(i, i + 420)).toMatch(/options\.fields\s*\n?\s*\.filter/);
  });
});

describe("el contrato socio–producto", () => {
  it("se aplica AL VENDER, no solo al listar", () => {
    /**
     * Es la mitad que faltaba y la que el plan subrayaba. Acotar el catálogo
     * esconde el producto de UNA pantalla; la reserva llega por el cuerpo de
     * una petición con un `product_id` dentro, y la de un socio que integra por
     * API ni siquiera pasa por esa pantalla. Un filtro de listado es una
     * sugerencia.
     */
    const servicio = cuerpoDe("src/lib/booking-service.ts");
    const i = servicio.indexOf("noAutorizados(");
    expect(i, "la venta no comprueba el contrato").toBeGreaterThan(-1);
    // Sobre el `throw`: afirmar que la función aparece deja borrar el
    // lanzamiento y conservar la llamada muerta.
    expect(servicio.slice(i, i + 700)).toMatch(/if \(fuera\.length > 0\)[\s\S]{0,520}throw[\s\S]{0,120}status: 403/);
    // Y antes de tomar plazas, consumir cupo o apuntar crédito: rechazar tarde
    // obliga a compensar escrituras que no había que haber hecho.
    expect(i).toBeLessThan(servicio.indexOf("assertCapacity("));
    expect(i).toBeLessThan(servicio.indexOf("creditCheck("));
  });

  it("y solo cuesta una consulta cuando la venta es de un socio", () => {
    // La venta propia del mostrador no pasa por ningún contrato: aplicárselo
    // apagaría el punto de venta entero.
    const servicio = cuerpoDe("src/lib/booking-service.ts");
    const i = servicio.indexOf("noAutorizados(");
    expect(servicio.slice(Math.max(0, i - 700), i)).toMatch(/if \(input\.partner_id\) \{/);
  });

  it("el catálogo del portal filtra SIEMPRE, también con la lista vacía", () => {
    /**
     * EL FALLO, EN UNA LÍNEA.
     *
     *     ...(authorizedIds.length ? { _id: { in: authorizedIds } } : {})
     *
     * Sin autorizaciones, sin filtro. Y `authorized_products` no existía en
     * ninguna tabla ni en el mapa de relaciones, así que la lista estaba vacía
     * SIEMPRE: ese filtro no se aplicó nunca, ni una vez.
     */
    const ruta = cuerpoDe("src/app/api/portal/catalog/route.ts");
    expect(ruta, "el filtro condicional ya no está")
      .not.toMatch(/authorizedIds\.length \?/);
    expect(ruta, "sale de su tabla").toMatch(/tenantQuery[\s\S]{0,80}"partner_product"/);
    /**
     * Y EL FILTRO SE APLICA.
     *
     * Comprobar que la lista se calcula y no que se usa dejaba borrar esta
     * línea y pasar la guarda: el catálogo volvía a enseñarlo todo con las
     * autorizaciones leídas y tiradas. No mordía; ahora sí.
     */
    expect(ruta, "el filtro está en la consulta").toMatch(/_id: \{ in: authorizedIds \}/);
    // Sin nada autorizado no se consulta, en vez de fiarlo a que `in: []`
    // signifique «ninguno»: en algún traductor es una condición que no se
    // aplica, y ahí el fallo sería devolver el catálogo entero.
    expect(ruta).toMatch(/authorizedIds\.length === 0 \? \[\] :/);
  });

  it("el socio no lee el contrato de los demás por el CRUD genérico", () => {
    // La lista de autorizaciones de los otros tour centers es el mapa de qué
    // vende cada uno. No está en su ámbito, ni propia ni compartida.
    const recursos = sinComentariosDe("src/lib/resources.ts");
    const ambito = recursos.slice(
      recursos.indexOf("const PARTNER_OWNED_TABLES"),
      recursos.indexOf("export type PartnerScope"));
    expect(ambito).not.toMatch(/"partner_product"/);
  });

  it("la migración siembra, o corta la venta de los socios existentes", () => {
    /**
     * En cuanto la lista vacía deja de significar «todo», un socio sin filas no
     * puede vender nada. Sin siembra, el despliegue apagaría la venta de todos
     * los tour centers a la vez — y el síntoma sería «el catálogo me sale
     * vacío», que nadie relaciona con una migración.
     */
    const sql = read("supabase/migrations/0077_partner_product.sql");
    /**
     * Con las TRES columnas proyectadas, no solo con la forma.
     *
     * Un `insert ... select` con el mismo `where` y un `null` donde va el socio
     * es una siembra que corre, no escribe nada útil y pasa una guarda que solo
     * mire el contorno. Se pinta qué va en cada columna.
     */
    expect(sql, "la siembra").toMatch(
      /insert into partner_product \(organization_id, partner_id, product_id\)\s*\nselect o\.tenant_org_id, o\.id, p\.id/
    );
    expect(sql, "de los socios").toMatch(/where o\.kind = 'partner'/);
    expect(sql, "solo el catálogo activo").toMatch(/p\.status <> 'inactive'/);
    // Y los dos disparadores que evitan el mismo apagón por los dos lados.
    // Con final de palabra: `create trigger product_autoriza_socios_off` CONTIENE
    // `create trigger product_autoriza_socios`, así que sin el límite un
    // disparador renombrado —o sea, desactivado— pasaba la guarda.
    expect(sql, "producto nuevo").toMatch(/create trigger product_autoriza_socios\b(?!_)/);
    expect(sql, "socio nuevo").toMatch(/create trigger organizations_autoriza_catalogo\b(?!_)/);
    // Tabla nueva y actor externo: su política, en la misma migración.
    expect(sql, "la política").toMatch(/enable_tenant_rls\('public\.partner_product', true\)/);
  });

  it("desautorizar no borra la fila", () => {
    // Queda el rastro de que ese producto estuvo autorizado, que es lo que se
    // mira cuando un tour center reclama una reserva que «antes sí podía».
    expect(read("supabase/migrations/0077_partner_product.sql"))
      .toMatch(/status\s+text not null default 'active' check \(status in \('active','inactive'\)\)/);
    expect(sinComentariosDe("src/app/dashboard/partners/catalogo/page.tsx"))
      .toMatch(/api\.put\(`\/api\/erp\/partner_product\/\$\{actual\._id\}`, \{ status:/);
  });
});

describe("el modelo comercial del socio", () => {
  it("el motor pregunta antes de empujar al socio como beneficiario", () => {
    /**
     * Antes bastaba con que la reserva tuviera socio. Un tour center que COMPRA
     * a precio neto lleva su margen dentro del precio que pagó: liquidarle
     * además una comisión es pagárselo dos veces, y no se ve el día de la venta
     * —las dos cifras son correctas por separado— sino un mes después.
     */
    const servicio = cuerpoDe("src/lib/booking-service.ts");
    expect(servicio).toMatch(/if \(partnerRow && devengaComision\(/);
    expect(servicio, "el empujón incondicional ya no está")
      .not.toMatch(/if \(partnerRow\) \{\s*beneficiaries\.push/);
  });

  it("y lo desconocido es COMISIÓN, no neto", () => {
    /**
     * Es lo que hacía el sistema con todos los socios antes de que la columna
     * existiera. Entender el hueco como `net` les quitaría la comisión a todos
     * de golpe el día del despliegue — el mismo apagón silencioso que evita la
     * siembra de 0077, con el signo cambiado.
     */
    const regla = cuerpoDe("src/lib/modelo-comercial.ts");
    expect(regla).toMatch(/partner\?\.pricing_model === "net" \? "net" : "commission"/);
    expect(read("supabase/migrations/0078_partner_pricing_model.sql"))
      .toMatch(/not null default 'commission'/);
  });

  it("se declara en la RELACIÓN, no en la organización", () => {
    // Es del contrato: la misma agencia puede trabajar a comisión con una
    // operadora y a neto con otra. Mismo sitio que las condiciones de 0073.
    expect(read("supabase/migrations/0078_partner_pricing_model.sql"))
      .toMatch(/alter table organization_relationships[\s\S]{0,200}pricing_model/);
    const partners = sinComentariosDe("src/lib/partners.ts");
    const mapa = partners.slice(
      partners.indexOf("PARTNER_RELATIONSHIP_COLUMNS"),
      partners.indexOf("PARTNER_DERIVED_FIELDS"));
    expect(mapa).toMatch(/pricing_model: "pricing_model"/);
  });

  it("y la ficha del socio lo pide, junto a la comisión que deja de aplicarse", () => {
    // Verlas juntas es lo que evita rellenar las dos creyendo que se suman.
    const pantalla = sinComentariosDe("src/app/dashboard/partners/page.tsx");
    const i = pantalla.indexOf('name: "pricing_model"');
    expect(i, "la ficha no lo pide").toBeGreaterThan(-1);
    expect(i).toBeLessThan(pantalla.indexOf('name: "default_commission_pct"'));
  });
});

describe("el socio que integra por API", () => {
  it("su reserva es SUYA: la llave lleva el socio y ahora se usa", () => {
    /**
     * `api_key.partner_id` existe desde que existe la tabla, `requireApiKey` lo
     * devuelve, y hasta esta entrega solo se escribía en la bitácora. Una
     * reserva hecha con la llave de un tour center nacía SIN socio, y con ella
     * se caían cinco cosas a la vez: su comisión, su límite de crédito, su
     * cupo, su contrato de productos y su propia pantalla de reservas, que
     * filtra por socio.
     *
     * El síntoma que se reporta es el inofensivo —«reservo por API y no me sale
     * en el portal»—. El que cuesta dinero es el primero.
     */
    const ruta = cuerpoDe("src/app/api/v1/bookings/route.ts");
    expect(ruta).toMatch(/createPublicBooking\(\s*page, parsed\.request, caller\.company, \{\}, caller\.partnerId\s*\)/);
    const motor = cuerpoDe("src/lib/public-booking-service.ts");
    expect(motor, "y el motor lo pone en la orden").toMatch(/partner_id: partnerId/);
  });

  it("y entra por el MISMO canal que su portal", () => {
    /**
     * Dos motivos. `b2b_api` no existe —`sales_channel` es un enum cerrado y el
     * tipo de TypeScript no lo dice, porque el canal viaja como cadena—, y
     * sobre todo: las reglas de precio se acotan por canal. Con un canal propio
     * para la API, el mismo tour center recibiría un precio por el portal y
     * otro por la integración, y descubriría la diferencia al facturar.
     */
    expect(cuerpoDe("src/lib/public-booking-service.ts"))
      .toMatch(/channel: partnerId \? "b2b_portal" : "web"/);
    // Y el canal existe en el enum de verdad.
    expect(read("supabase/migrations/0003_enums.sql")).toMatch(/'b2b_portal'/);
  });

  it("la API le enseña SU catálogo, no el catálogo", () => {
    // El contrato por producto se aplicaba en el portal y al vender, y esta
    // ruta —por donde mira un socio que integra antes de reservar— se había
    // quedado fuera: le enseñaba productos que su reserva iba a rechazar.
    const ruta = cuerpoDe("src/app/api/v1/products/route.ts");
    expect(ruta).toMatch(/caller\.partnerId[\s\S]{0,200}"partner_product"/);
    expect(ruta, "y el filtro se aplica").toMatch(/\.\.\.\(autorizados \? \{ _id: \{ in: autorizados \} \} : \{\}\)/);
    expect(ruta, "sin nada autorizado, nada").toMatch(/autorizados !== null && autorizados\.length === 0/);
  });

  it("el tarifario y la API salen de la MISMA función", () => {
    /**
     * El criterio del plan es que «el tarifario descargado coincide con lo que
     * la API devuelve». Eso no se consigue revisándolo: se consigue teniendo
     * una sola función que los produzca. Dos implementaciones del mismo precio
     * divergen el día que alguien añade una regla de temporada a una de las
     * dos, y la divergencia sale a la luz facturando.
     */
    expect(cuerpoDe("src/app/api/portal/tarifario/route.ts")).toMatch(/tarifarioDeSocio\(/);
    expect(cuerpoDe("src/app/api/v1/products/route.ts")).toMatch(/tarifarioDeSocio\(/);
    // Y esa función no calcula precios: se los pide al motor.
    const tarifario = cuerpoDe("src/lib/tarifario.ts");
    expect(tarifario).toMatch(/await resolvePrice\(/);
    expect(tarifario, "nada de fórmulas a mano").not.toMatch(/base_price|default_commission_pct/);
    // Con el mismo canal con el que reserva: con otro, el tarifario diría un
    // precio y la reserva cobraría otro.
    expect(tarifario).toMatch(/channel: "b2b_portal"/);
  });

  /**
   * «Un producto sin tarifa no tumba el tarifario entero» NO se guarda aquí.
   *
   * Aquí había un guardia que buscaba un `catch (err)` cerca del
   * `resolvePrice`. No mordía: un `catch` que vuelva a lanzar el error lo
   * cumple al pie de la letra y rompe el archivo igual. Esa propiedad es de lo
   * que SALE, no del texto, y vive probada en `src/lib/tarifario.test.ts`
   * ejecutando la función con un producto cuyo precio revienta.
   */

  /* ═══════════════════════════════════ Fase 6.4 · el cupo, visible antes */

  it("el catálogo del portal cruza las plazas con EL CUPO DEL SOCIO", () => {
    /**
     * Enseñaba las plazas libres de la SALIDA. Un socio con diez garantizadas
     * veía las cuarenta de la guagua, vendía quince, y el 409 de
     * `assertAllotment` le llegaba en la cara del turista que tenía delante.
     *
     * El motor de cupos no estaba roto —comprueba bien, y en el único camino
     * que crea reservas—: estaba escondido, y un límite que solo aparece al
     * final es indistinguible de un fallo del sistema.
     */
    const catalogo = cuerpoDe("src/app/api/portal/catalog/route.ts");
    expect(catalogo).toMatch(/allotmentsOf\(ctx\.companyId, partnerId\)/);
    // Y el resultado se USA en la salida, no solo se calcula: la línea que
    // importa es la que sustituye el número, no la que lo obtiene.
    expect(catalogo, "available_pax sale del cupo, no de la salida")
      .toMatch(/available_pax: cupo\.disponible/);
    expect(catalogo, "y el cupo cruza las dos cosas")
      .toMatch(/cupoVisible\(\s*plazasLibres\(/);
  });

  it("la pantalla de reservar NO vuelve a calcular las plazas", () => {
    /**
     * Si reconstruye el número en el navegador a partir de `capacity`, cuando
     * el servidor contesta «no se sabe» le sale la guagua entera: afirmaría
     * cuarenta plazas libres justo cuando nadie las ha contado. Y peor: se
     * saltaría el cupo, que es lo que esta ola vino a enseñar.
     */
    const pantalla = cuerpoDe("src/app/portal/reservar/page.tsx");
    expect(pantalla).toMatch(/cupoParaMostrar\(salida\?\.cupo\)/);
    expect(pantalla, "el número lo da el servidor ya cruzado")
      .not.toMatch(/plazasParaMostrar\(/);
  });

  it("solo se bloquea el botón por lo que no cambia esperando", () => {
    /**
     * Bloquear por una salida llena le quitaría al socio la plaza que acaba de
     * liberar una cancelación, con un número de hace dos minutos. Bloquear por
     * un cupo CERRADO es lo contrario: no se abre solo, y dejar el botón vivo
     * ahí solo sirve para que escriba los datos del turista y se coma un 409.
     */
    const dominio = cuerpoDe("src/lib/cupo-socio.ts");
    const i = dominio.indexOf("MOTIVO_DEFINITIVO");
    expect(dominio.slice(i, i + 400)).toMatch(/cerrado: true/);
    expect(dominio.slice(i, i + 400)).toMatch(/salida_llena: false/);
    expect(cuerpoDe("src/app/portal/reservar/page.tsx"))
      .toMatch(/disabled=\{!salida \|\| \(salida\.cupo\?\.motivo \? MOTIVO_DEFINITIVO\[/);
  });

  it("/api/portal/cupos se acota por la FICHA, no por el parámetro", () => {
    /**
     * Atender un `?partner=` a quien es del socio convertiría esta ruta en la
     * forma de leer el contrato de plazas de la agencia de enfrente: cuántas le
     * apartan y cuántas lleva vendidas.
     */
    const ruta = cuerpoDe("src/app/api/portal/cupos/route.ts");
    const i = ruta.indexOf("if (esDeSocio(ctx))");
    expect(i, "la ruta pregunta por la ficha").toBeGreaterThan(-1);
    // La rama del socio toma SU identificador y no mira `sp.get`.
    const rama = ruta.slice(i, ruta.indexOf("} else {", i));
    expect(rama).toMatch(/partnerId = ctx\.partnerId/);
    expect(rama, "sin tocar el parámetro").not.toMatch(/sp\.get/);
    // Y el interno necesita manager para mirar el de otro.
    expect(ruta).toMatch(/requireAtLeast\(ctx, "manager"\)/);
  });

  it("la disponibilidad por API respeta el contrato Y el cupo", () => {
    /**
     * Dos cosas que esta ruta no miraba y la reserva sí. Sin la primera, un
     * socio integrado planifica sobre un producto que no tiene autorizado;
     * sin la segunda, sobre plazas que no son suyas. En los dos casos el
     * rechazo llega al confirmar, cuando ya no puede hacer nada.
     */
    const ruta = cuerpoDe("src/app/api/v1/availability/route.ts");
    expect(ruta, "el contrato por producto").toMatch(/autorizados\.has\(productId\)/);
    expect(ruta, "y el cupo").toMatch(/allotmentsOf\(caller\.companyId, caller\.partnerId\)/);
    // `seatsLeft` pasa a ser LO SUYO: dejarle el número grande al lado del
    // pequeño es pedirle a quien integra que elija el equivocado.
    expect(ruta).toMatch(/seatsLeft: cupo\.disponible/);
    // Y lo que su contrato no le deja vender no se devuelve como disponible.
    expect(ruta).toMatch(/filter\(\(d\) => d\.allotment\.motivo === null\)/);
  });

  it("el portal no repite una entrada de menú", () => {
    /**
     * `p-reservar` estaba dos veces, palabra por palabra: dos líneas iguales en
     * el menú del socio y dos claves de React idénticas. Una lista escrita a
     * mano acumula esto en silencio, y una guarda de tres líneas lo caza.
     */
    const ids = PORTAL_NAV.map((n) => n.id);
    expect(ids, "ids repetidos en PORTAL_NAV").toEqual([...new Set(ids)]);
    const hrefs = PORTAL_NAV.map((n) => n.href);
    expect(hrefs, "rutas repetidas en PORTAL_NAV").toEqual([...new Set(hrefs)]);
  });

  it("«mi cupo» tiene pantalla y entrada de menú", () => {
    // Una pantalla sin menú es un módulo muerto: existe, funciona y no la
    // encuentra nadie.
    expect(existe("src/app/portal/cupos/page.tsx")).toBe(true);
    expect(PORTAL_NAV.some((n) => n.href === "/portal/cupos")).toBe(true);
  });
});
