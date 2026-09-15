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
    // La API acota a las notificaciones propias más los avisos a toda la empresa.
    const route = read("src/app/api/notifications/route.ts");
    expect(route).toContain("_or: [{ user_id: userId }, { user_id: null }]");
    expect(route).toContain("mark_all_read");
    // La ruta de marcado verifica pertenencia antes de escribir.
    const readRoute = read("src/app/api/notifications/[id]/read/route.ts");
    expect(readRoute).toContain("Esta notificación no es tuya");
    // El sidebar cuenta las no leídas con el mismo alcance personal.
    expect(read("src/lib/nav.ts")).toContain('badgeKey: "notifications"');
    expect(read("src/app/dashboard/layout.tsx")).toContain("_or: [{ user_id: userId }, { user_id: null }], read_status: false");
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
    const route = read("src/app/api/erp/[resource]/route.ts");
    expect(route).toContain("decidableFilter(ctx)");
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
    expect(route).toContain("assertRateLimit");
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
