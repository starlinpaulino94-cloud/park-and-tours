import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { TenantContext } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/* --------------------------------- mocks --------------------------------- */

const requireTenant = vi.fn();
const tenantQuery = vi.fn();
const tenantCount = vi.fn();
const pendingFor = vi.fn();
const countDecidableFor = vi.fn();
const resolveUserNames = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => <a href={String(href)} {...rest}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/inicio/mi-dia",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api: { post: vi.fn(), get: vi.fn() } }));

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    requireTenant: (...args: unknown[]) => requireTenant(...args),
    tenantQuery: (...args: unknown[]) => tenantQuery(...args),
    tenantCount: (...args: unknown[]) => tenantCount(...args),
  };
});
vi.mock("@/lib/approvals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/approvals")>();
  return {
    ...actual,
    pendingFor: (...args: unknown[]) => pendingFor(...args),
    countDecidableFor: (...args: unknown[]) => countDecidableFor(...args),
  };
});
vi.mock("@/lib/user-directory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/user-directory")>();
  return { ...actual, resolveUserNames: (...args: unknown[]) => resolveUserNames(...args) };
});

import MyDayPage from "./page";
import { ApprovalsSection, Counters, TasksSection } from "./_components/sections";

/* --------------------------------- fixtures ------------------------------- */

const EMAIL = "starlin.eltanquemotors@gmail.com";

const ctxOf = (role: AppRole = "manager", over: Partial<TenantContext> = {}): TenantContext & { companyId: string } => ({
  userId: "user-1", email: EMAIL, name: "Starlin Paulino", role,
  companyId: "org-1", partnerId: null,
  company: { _id: "org-1", name: "Park & Tours", timezone: "America/Santo_Domingo", base_currency: "dop" } as never,
  ...over,
}) as TenantContext & { companyId: string };

beforeEach(() => {
  vi.clearAllMocks();
  tenantQuery.mockResolvedValue([]);
  tenantCount.mockResolvedValue(0);
  pendingFor.mockResolvedValue([]);
  countDecidableFor.mockResolvedValue(0);
  resolveUserNames.mockResolvedValue(new Map());
});

afterEach(cleanup);

/* ---------------------------------- tests --------------------------------- */

describe("Mi día — encabezado", () => {
  it("el título visible es exactamente 'Mi día'", async () => {
    requireTenant.mockResolvedValue(ctxOf("superadmin"));
    render(await MyDayPage({ searchParams: Promise.resolve({}) }));

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Mi día");
  });

  it("no aparece ningún saludo", async () => {
    requireTenant.mockResolvedValue(ctxOf("superadmin"));
    const { container } = render(await MyDayPage({ searchParams: Promise.resolve({}) }));

    expect(container.textContent).not.toMatch(/hola/i);
    expect(container.textContent).not.toMatch(/bienvenid/i);
    expect(container.textContent).not.toMatch(/buenos días|buenas tardes/i);
  });

  it("no muestra el nombre ni el correo del usuario autenticado", async () => {
    requireTenant.mockResolvedValue(ctxOf("superadmin"));
    const { container } = render(await MyDayPage({ searchParams: Promise.resolve({}) }));

    expect(container.textContent).not.toContain(EMAIL);
    expect(container.textContent).not.toContain("Starlin");
    expect(container.textContent).not.toContain("@");
  });

  it("no hay descripción bajo el título ni eyebrow 'Inicio'", async () => {
    requireTenant.mockResolvedValue(ctxOf("superadmin"));
    const { container } = render(await MyDayPage({ searchParams: Promise.resolve({}) }));

    const header = container.querySelector("header")!;
    // El encabezado contiene el h1 y nada más de texto.
    expect(header.textContent).toBe("Mi día");
  });

  it("el superadministrador sin empresa suplantada ve el mismo título", async () => {
    requireTenant.mockResolvedValue(ctxOf("superadmin"));
    render(await MyDayPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Mi día");
    expect(screen.getByText(/Panel de plataforma activo/)).toBeTruthy();
  });
});

describe("Mi día — contadores", () => {
  it("consulta solo tareas del usuario y de su empresa", async () => {
    render(await Counters({ ctx: ctxOf("manager"), filter: "todas" }));

    expect(tenantCount).toHaveBeenCalledTimes(3);
    for (const call of tenantCount.mock.calls) {
      expect(call[0]).toBe("org-1");
      expect(call[1]).toBe("task");
      expect(call[2].assigned_to).toBe("user-1");
    }
  });

  it("no incluye 'Tareas abiertas' y sí las cuatro métricas exigidas", async () => {
    const { container } = render(await Counters({ ctx: ctxOf("manager"), filter: "todas" }));

    expect(container.textContent).not.toMatch(/tareas abiertas/i);
    for (const label of ["Vencidas", "Vencen hoy", "Prioridad alta", "Aprobaciones pendientes"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("cada contador es un enlace navegable con foco visible", async () => {
    render(await Counters({ ctx: ctxOf("manager"), filter: "todas" }));

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link.getAttribute("href")).toBeTruthy();
      expect(link.className).toContain("focus-visible:ring-2");
    }
  });

  it("marca el contador activo con aria-current", async () => {
    render(await Counters({ ctx: ctxOf("manager"), filter: "vencidas" }));
    const active = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "true");
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("href")).toContain("f=vencidas");
  });

  it("un contador que falla muestra '—', no un cero falso", async () => {
    tenantCount.mockRejectedValueOnce(new Error("supabase caído"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(await Counters({ ctx: ctxOf("manager"), filter: "todas" }));

    expect(screen.getByText("—")).toBeTruthy();
  });

  it("un rol sin autorización no dispara el conteo de aprobaciones", async () => {
    await Counters({ ctx: ctxOf("seller"), filter: "todas" });
    expect(countDecidableFor).not.toHaveBeenCalled();
  });
});

describe("Mi día — tareas prioritarias", () => {
  const overdue = {
    _id: "t1", title: "Cerrar caja del turno noche", description: "Arqueo completo",
    status: "todo", priority: "high", due_at: "2020-01-01T12:00:00Z", assigned_to_id: "user-1",
  };

  it("muestra las tareas con vencimiento, prioridad y estado", async () => {
    tenantQuery.mockResolvedValue([overdue]);
    render(await TasksSection({ ctx: ctxOf("manager"), filter: "todas" }));

    expect(screen.getByText("Cerrar caja del turno noche")).toBeTruthy();
    expect(screen.getByText(/^Vencida hace/)).toBeTruthy();
    expect(screen.getByText("Alta")).toBeTruthy();
    expect(screen.getByText("Por hacer")).toBeTruthy();
  });

  it("el título truncado conserva el texto completo accesible", async () => {
    tenantQuery.mockResolvedValue([overdue]);
    const { container } = render(await TasksSection({ ctx: ctxOf("manager"), filter: "todas" }));

    const title = container.querySelector("p.truncate")!;
    expect(title.getAttribute("title")).toBe("Cerrar caja del turno noche");
  });

  it("ofrece los cinco filtros rápidos", async () => {
    render(await TasksSection({ ctx: ctxOf("manager"), filter: "todas" }));
    const group = screen.getByRole("group", { name: /filtros rápidos/i });
    for (const label of ["Todas", "Vencidas", "Hoy", "Urgentes", "En curso"]) {
      expect(within(group).getByText(label)).toBeTruthy();
    }
  });

  it("el estado vacío es una sola línea, sin párrafos explicativos", async () => {
    tenantQuery.mockResolvedValue([]);
    render(await TasksSection({ ctx: ctxOf("manager"), filter: "todas" }));
    expect(screen.getByText("No tienes tareas pendientes.")).toBeTruthy();
  });

  it("solo consulta tareas del usuario dentro de su empresa", async () => {
    await TasksSection({ ctx: ctxOf("manager"), filter: "vencidas" });
    expect(tenantQuery.mock.calls[0][0]).toBe("org-1");
    expect(tenantQuery.mock.calls[0][1]).toBe("task");
    expect(tenantQuery.mock.calls[0][2]._filter.assigned_to).toBe("user-1");
  });

  it("no ofrece completar una tarea ajena a quien no tiene rango de gestión", async () => {
    tenantQuery.mockResolvedValue([{ ...overdue, assigned_to_id: "otra-persona" }]);
    render(await TasksSection({ ctx: ctxOf("seller"), filter: "todas" }));

    expect(screen.queryByRole("button", { name: /marcar como completada/i })).toBeNull();
  });

  it("ofrece completar la tarea propia", async () => {
    tenantQuery.mockResolvedValue([overdue]);
    render(await TasksSection({ ctx: ctxOf("seller"), filter: "todas" }));

    expect(screen.getByRole("button", { name: /marcar como completada/i })).toBeTruthy();
  });
});

describe("Mi día — aprobaciones", () => {
  const request = {
    _id: "ap-1", code: "AP-K3M9Q", action_type: "payout", reason: "Liquidación mensual de la red",
    amount: 12500, currency: "dop", requested_at: "2026-08-25T12:00:00Z", expires_at: null,
    requires_two: true, requested_by: "user-9", approved_by: null,
  };

  it("muestra código, acción, importe, solicitante y requisito de firma", async () => {
    pendingFor.mockResolvedValue([request]);
    resolveUserNames.mockResolvedValue(new Map([["user-9", "María Fernández"]]));
    render(await ApprovalsSection({ ctx: ctxOf("admin") }));

    expect(screen.getByText("AP-K3M9Q")).toBeTruthy();
    expect(screen.getByText("Pago a la red")).toBeTruthy();
    expect(screen.getByText(/RD\$12,500\.00/)).toBeTruthy();
    expect(screen.getByText(/María Fernández/)).toBeTruthy();
    expect(screen.getByText("Doble firma")).toBeTruthy();
  });

  it("sin nombre registrado NO cae al correo del solicitante", async () => {
    pendingFor.mockResolvedValue([request]);
    resolveUserNames.mockResolvedValue(new Map());
    const { container } = render(await ApprovalsSection({ ctx: ctxOf("admin") }));

    expect(container.textContent).toContain("Solicitante sin nombre registrado");
    expect(container.textContent).not.toContain("@");
  });

  it("expone aprobar, rechazar y revisar", async () => {
    pendingFor.mockResolvedValue([request]);
    render(await ApprovalsSection({ ctx: ctxOf("admin") }));

    expect(screen.getByRole("button", { name: "Aprobar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revisar" })).toBeTruthy();
  });

  it("un rol sin autorización no ve la sección ni sus acciones", async () => {
    const result = await ApprovalsSection({ ctx: ctxOf("seller") });
    expect(result).toBeNull();
    expect(pendingFor).not.toHaveBeenCalled();
  });

  it("el estado vacío es una sola línea", async () => {
    pendingFor.mockResolvedValue([]);
    render(await ApprovalsSection({ ctx: ctxOf("admin") }));
    expect(screen.getByText("No hay solicitudes esperando tu decisión.")).toBeTruthy();
  });

  it("no ejecuta ninguna decisión al renderizar", async () => {
    const { api } = await import("@/lib/api");
    pendingFor.mockResolvedValue([request]);
    render(await ApprovalsSection({ ctx: ctxOf("admin") }));
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("Mi día — fallo parcial", () => {
  it("si fallan las tareas, las aprobaciones siguen visibles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tenantQuery.mockRejectedValue(new Error("timeout"));
    pendingFor.mockResolvedValue([]);

    render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" }));
    render(await ApprovalsSection({ ctx: ctxOf("admin") }));

    expect(screen.getByRole("alert").textContent).toContain("No se pudieron cargar tus tareas.");
    expect(screen.getByText("No hay solicitudes esperando tu decisión.")).toBeTruthy();
  });

  it("si fallan las aprobaciones, las tareas siguen visibles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pendingFor.mockRejectedValue(new Error("timeout"));
    tenantQuery.mockResolvedValue([]);

    render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" }));
    render(await ApprovalsSection({ ctx: ctxOf("admin") }));

    expect(screen.getByText("No tienes tareas pendientes.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("No se pudieron cargar las aprobaciones.");
  });

  it("el error de una sección se anuncia a los lectores de pantalla", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tenantQuery.mockRejectedValue(new Error("timeout"));
    render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

/**
 * jsdom no calcula geometría, así que aquí no se mide un desbordamiento real:
 * se verifican los MECANISMOS que lo provocan en flexbox y rejilla. Son los
 * tres que causan scroll horizontal en la práctica: un ancho fijo mayor que el
 * viewport, un hijo flexible sin `min-w-0` que se niega a encogerse por debajo
 * de su contenido, y un contenedor que no envuelve. Una regresión puramente
 * visual de CSS seguiría necesitando un navegador.
 */
describe("Mi día — móvil", () => {
  /** Anchos fijos por encima del viewport más estrecho que se soporta (320px). */
  const FIXED_WIDTH = /(?:^|\s)(?:w|min-w|basis)-\[(\d+)px\]/;
  /** Utilidades que impiden encoger un elemento por debajo de su contenido. */
  const UNSHRINKABLE = /(?:^|\s)(?:w-screen|w-max|min-w-max|min-w-screen)(?:\s|$)/;

  const collectClasses = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>("*")).map((el) => el.className || "");

  const busyTrees = async () => {
    tenantQuery.mockResolvedValue([{
      _id: "t1", title: "Tarea con un título deliberadamente largo para forzar el truncado en pantallas estrechas",
      description: "Descripción larga", status: "in_progress", priority: "urgent",
      due_at: "2026-08-25T22:00:00Z", assigned_to_id: "user-1",
    }]);
    pendingFor.mockResolvedValue([{
      _id: "ap-1", code: "AP-1", action_type: "refund",
      reason: "Motivo excepcionalmente largo que obliga a truncar el texto de la solicitud",
      amount: 1234567.89, currency: "dop", requested_at: "2026-08-25T12:00:00Z",
      requires_two: true, requested_by: "user-9", approved_by: null,
    }]);
    return [
      render(await Counters({ ctx: ctxOf("admin"), filter: "todas" })).container,
      render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" })).container,
      render(await ApprovalsSection({ ctx: ctxOf("admin") })).container,
    ];
  };

  it("todo texto truncado cuelga de un contenedor que puede encogerse", async () => {
    // La causa clásica de scroll horizontal: un hijo de flex con `truncate`
    // pero sin `min-w-0` en su cadena de ancestros mantiene su ancho intrínseco
    // y empuja la fila fuera de la pantalla.
    for (const tree of await busyTrees()) {
      for (const el of Array.from(tree.querySelectorAll<HTMLElement>(".truncate"))) {
        let node: HTMLElement | null = el;
        let shrinkable = false;
        while (node && node !== tree) {
          if (/(?:^|\s)min-w-0(?:\s|$)/.test(node.className || "")) { shrinkable = true; break; }
          node = node.parentElement;
        }
        expect(shrinkable, `sin min-w-0 en la cadena de "${el.textContent?.slice(0, 40)}"`).toBe(true);
      }
    }
  });

  it("ningún elemento usa utilidades que impidan encoger", async () => {
    for (const tree of await busyTrees()) {
      for (const className of collectClasses(tree)) {
        expect(UNSHRINKABLE.test(className), `clase no encogible: ${className}`).toBe(false);
      }
    }
  });

  it("los estados de error y vacío tampoco desbordan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tenantQuery.mockRejectedValue(new Error("timeout"));
    pendingFor.mockRejectedValue(new Error("timeout"));

    const trees = [
      render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" })).container,
      render(await ApprovalsSection({ ctx: ctxOf("admin") })).container,
    ];
    for (const tree of trees) {
      for (const className of collectClasses(tree)) {
        expect(UNSHRINKABLE.test(className)).toBe(false);
        const match = FIXED_WIDTH.exec(className);
        if (match) expect(Number(match[1])).toBeLessThanOrEqual(320);
      }
      // El aviso de error envuelve en vez de forzar una línea única.
      expect(tree.querySelector('[role="alert"]')!.className).toContain("flex-wrap");
    }
  });

  it("ningún elemento fija un ancho mayor que 320px", async () => {
    tenantQuery.mockResolvedValue([{
      _id: "t1", title: "Tarea con un título deliberadamente largo para forzar el truncado",
      status: "in_progress", priority: "urgent", due_at: "2026-08-25T22:00:00Z", assigned_to_id: "user-1",
    }]);
    pendingFor.mockResolvedValue([{
      _id: "ap-1", code: "AP-1", action_type: "refund", reason: "Motivo",
      amount: 100, currency: "dop", requested_at: "2026-08-25T12:00:00Z",
      requires_two: false, requested_by: "user-9", approved_by: null,
    }]);

    const trees = [
      render(await Counters({ ctx: ctxOf("admin"), filter: "todas" })).container,
      render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" })).container,
      render(await ApprovalsSection({ ctx: ctxOf("admin") })).container,
    ];

    for (const tree of trees) {
      for (const className of collectClasses(tree)) {
        const match = FIXED_WIDTH.exec(className);
        if (match) expect(Number(match[1])).toBeLessThanOrEqual(320);
      }
    }
  });

  it("los contadores se reorganizan a dos columnas en móvil", async () => {
    const { container } = render(await Counters({ ctx: ctxOf("admin"), filter: "todas" }));
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("lg:grid-cols-4");
  });

  it("las filas envuelven en lugar de desbordar horizontalmente", async () => {
    tenantQuery.mockResolvedValue([{
      _id: "t1", title: "Tarea", status: "todo", priority: "low",
      due_at: null, assigned_to_id: "user-1",
    }]);
    const { container } = render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" }));
    const row = container.querySelector("li")!;
    expect(row.className).toContain("flex-wrap");
  });

  it("los botones de acción tienen área táctil suficiente", async () => {
    tenantQuery.mockResolvedValue([{
      _id: "t1", title: "Tarea", status: "todo", priority: "low",
      due_at: null, assigned_to_id: "user-1",
    }]);
    render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" }));
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/h-9|h-10|min-h-9/);
    }
  });

  it("los filtros rápidos también son pulsables con el dedo", async () => {
    render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" }));
    const group = screen.getByRole("group", { name: /filtros rápidos/i });
    for (const chip of within(group).getAllByRole("link")) {
      expect(chip.className).toContain("min-h-9");
    }
  });
});

describe("Mi día — etiquetas temporales en vivo", () => {
  it("la fila recibe el instante y la zona para poder refrescar la etiqueta", async () => {
    tenantQuery.mockResolvedValue([{
      _id: "t1", title: "Tarea", status: "todo", priority: "low",
      due_at: "2026-08-25T22:00:00Z", assigned_to_id: "user-1",
    }]);
    const { container } = render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" }));

    // El texto se recalcula en el cliente con la misma función pura, así que
    // sigue siendo una etiqueta relativa legible y no una fecha cruda.
    const row = within(container.querySelector("li")!);
    expect(row.getByText(/^(Hoy|Mañana|Vencida) /)).toBeTruthy();
  });

  it("una tarea sin fecha conserva la etiqueta del servidor", async () => {
    tenantQuery.mockResolvedValue([{
      _id: "t1", title: "Tarea", status: "todo", priority: "low",
      due_at: null, assigned_to_id: "user-1",
    }]);
    render(await TasksSection({ ctx: ctxOf("admin"), filter: "todas" }));
    expect(screen.getByText("Sin vencimiento")).toBeTruthy();
  });
});
