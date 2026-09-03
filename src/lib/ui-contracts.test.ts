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
    expect(read("src/lib/labels.ts")).toContain('otros: def("Otros"');
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
    expect(source).toContain("<PageHeader title=\"Tareas\" />");
    expect(source).toContain("<TaskRow");
    expect(source).toContain("listFilter(filter, ctx.userId");
    expect(source).not.toContain("eyebrow=");
  });

  it("el ERP resuelve referencias de usuario como nombre, no como correo", () => {
    const route = read("src/app/api/erp/[resource]/route.ts");
    expect(route).toContain("resolveUserNames");
    expect(route).toContain("resolveUserRefs");
    expect(route).toContain("Usuario sin nombre registrado");
    expect(route).not.toContain("email:");
  });

  it("el ERP resuelve referencias públicas por lote antes de pintar UUID", () => {
    const route = read("src/app/api/erp/[resource]/route.ts");
    expect(route).toContain("resolvePublicRefs");
    expect(route).toContain("relationResource");
    expect(route).toContain("_filter: { _id: { in: ids } }");
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
