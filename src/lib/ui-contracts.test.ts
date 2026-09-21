import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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
    const page = read("src/app/dashboard/page.tsx");
    expect(page).toContain('title="Panel ejecutivo"');
    expect(page).not.toContain('eyebrow="Dirección"');
    expect(page).not.toContain("Todo lo que está pasando");
    expect(page).not.toContain("user.email");
  });

  it("no duplica Ventas de hoy ni usa mensajes motivacionales", () => {
    const page = read("src/app/dashboard/page.tsx");
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
    const page = read("src/app/dashboard/page.tsx");
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
    const page = read("src/app/dashboard/page.tsx");
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
    // Es una lista de clientes: un partner no ve las reservas de la competencia.
    expect(route).toMatch(/role === "partner"/);

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
    expect(route).toMatch(/partner"\)\s*delete body\.allow_over_credit/);
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
    // Cada devengo se enlaza AL RECLAMARLO: sin eso, dos generaciones
    // simultáneas incluirían el mismo servicio dos veces.
    expect(service).toMatch(/CLAIMABLE\.has\(fresh\.status/);
    expect(service).toMatch(/status: "settled", settlement: settlement\._id/);
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
    const page = read("src/app/dashboard/page.tsx");
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
    expect(read("src/app/dashboard/page.tsx")).toContain("function channelLabel");
    expect(read("src/lib/labels.ts")).not.toContain('otros: def("Otros"');
  });

  it("B5 — el indicador de tendencia tiene estado neutro para 0%", () => {
    const card = read("src/components/tf/kpi-card.tsx");
    expect(card).toContain('"flat"');
    expect(card).toContain("ArrowRight");
  });

  it("los filtros del dashboard usan opciones legibles y no campos manuales por ID", () => {
    const page = read("src/app/dashboard/page.tsx");
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
    expect(invite).toMatch(/roleDecision\(ctx\.role, body\.role \|\| "seller"\)/);
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
    expect(read("src/app/api/team/invite/route.ts")).toMatch(/assertWithinLimit\(ctx, "max_users"\)/);
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
    expect(read("src/app/api/team/invite/route.ts")).toMatch(/branch_id: \(body\.branch/);
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
    const shared = read("src/lib/erp-query.ts");
    expect(shared).toMatch(/_and: \[filter, branchFilter\]/);
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
  ];

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
    // Sin esto, un rol que no puede ver un recurso en pantalla se lo llevaría
    // entero en un archivo.
    const route = read("src/app/api/export/[resource]/route.ts");
    expect(route).toMatch(/readRoleFor\(def\.table\)/);
    expect(route).toMatch(/requireAtLeast\(ctx, rr\)/);
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
      expect(src, file).toMatch(/await assertPayloadAssignable\(ctx\.companyId, def\.table, payload\)/);
    }
  });

  it("la comprobación va ANTES de escribir, no después", () => {
    for (const [file, escritura] of [
      ["src/app/api/erp/[resource]/route.ts", "await tenantCreate(ctx.companyId, def.table, payload)"],
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
    // Seis builders y seis llamantes: bastaba con que uno se olvidara para que
    // ESE documento saliera del color de casa sin que nadie supiera por qué.
    const src = read("src/lib/pdf/documents.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const creates = src.match(/await PdfBuilder\.create\(\{/g) ?? [];
    const brands = src.match(/await brandFor\(company, "/g) ?? [];
    expect(creates.length).toBeGreaterThanOrEqual(6);
    expect(brands.length).toBe(creates.length);
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

  it("un vendedor escogido a mano no lo pisa el histórico", () => {
    // Pisar la elección de quien está delante del cliente sería discutirle a
    // quien vendió quién vendió.
    const src = sinComentarios("src/lib/booking-service.ts");
    expect(src).toMatch(/let attributedSeller = input\.seller_id \|\| null;/);
    expect(src).toMatch(/if \(!attributedSeller\) \{\s*const attribution = await resolveOrderAttribution/);
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
    "/dashboard/analitica/cohortes": "cohortes: se calculan",
    "/dashboard/rentabilidad": "márgenes: se calculan de ventas y costes",
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
      const alrededor = src.slice(Math.max(0, lista!.index - 600), lista!.index + 800);
      expect(alrededor, `${archivo}: la lista no se aplica a ninguna orden`).toMatch(/order/i);
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
  const SIN_SESION = ["src/lib/voice-service.ts", "src/lib/octo-service.ts"];

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
