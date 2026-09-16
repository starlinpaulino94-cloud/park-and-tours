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
    const files = walk(path.join(ROOT, "src/app/dashboard/inicio/mi-dia"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/Hola,/);
      expect(source).not.toMatch(/ctx\.name/);
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
      purchase_order_line: "es hija de su orden de compra",
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
      "src/app/api/bookings/[id]/cancel/route.ts",
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
    expect(read("src/app/api/bookings/[id]/cancel/route.ts")).toContain("cancelBookingCosts");
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
    // La seguridad de la propia cuenta no es una operación de la empresa: una
    // suscripción vencida no puede impedirle a nadie activar —ni QUITAR— su
    // segundo factor. Bloquearlo dejaría a alguien que acaba de desenrolar su
    // teléfono con la marca puesta y sin factores, es decir, fuera de su
    // cuenta por no pagar.
    /^src\/app\/api\/account\/mfa\//,
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
    const cancel = read("src/app/api/bookings/[id]/cancel/route.ts");
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
    ["booking_cancelled", "src/app/api/bookings/[id]/cancel/route.ts"],
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
