import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/**
 * EL ÁMBITO DEL VENDEDOR, PROBADO CONTRA LA RUTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA CON LAS PRUEBAS DE `seller-scope.ts`
 *
 * Aquellas comprueban que la REGLA es correcta. Estas comprueban que la ruta la
 * LLAMA, que es otra cosa: el ámbito puede estar perfectamente escrito y la
 * ruta no aplicarlo —ya pasó con `/api/orders`, que arma su propio filtro y se
 * quedó fuera del armador compartido—. Y un filtro que falta no da error:
 * devuelve la empresa entera.
 *
 * Aquí se falsea SOLO el suelo (`tenantQuery`, `tenantCount`, `tenantFindOne`)
 * y se deja correr de verdad todo lo de arriba: la autorización por rango, el
 * armador del filtro, el ámbito y el recorte de columnas. Así lo que se
 * comprueba es lo único que importa: qué filtro llega a la base y qué sale por
 * la respuesta.
 */

const requireTenant = vi.fn();
const requireTenantWrite = vi.fn();
/** El `_filter` que la ruta acabó mandando a la base. */
let filtroRecibido: Record<string, unknown> | null = null;
/** Lo que la base devuelve. */
let filas: Record<string, unknown>[] = [];
let filaUnica: Record<string, unknown> = {};

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    requireTenant: (...a: unknown[]) => requireTenant(...a),
    requireTenantWrite: (...a: unknown[]) => requireTenantWrite(...a),
    tenantQuery: async (_c: string, _t: string, options: Record<string, unknown>) => {
      filtroRecibido = (options?._filter as Record<string, unknown>) ?? null;
      return filas;
    },
    tenantCount: async () => filas.length,
    tenantFindOne: async () => filaUnica,
  };
});
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), rateLimitKey: () => "k" }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/field-projection", async (importOriginal) => importOriginal());

const { GET: listar } = await import("./[resource]/route");
const { GET: detalle } = await import("./[resource]/[id]/route");
const { GET: exportar } = await import("../export/[resource]/route");

function ctx(role: AppRole, sellerId: string | null): TenantContext & { companyId: string } {
  return {
    userId: "u1", email: "u@x.com", name: "U", role,
    companyId: "org-1", partnerId: null, branchId: null, sellerId, company: null,
  } as TenantContext & { companyId: string };
}

function peticion(url: string): NextRequest {
  return { nextUrl: new URL(url), headers: new Headers() } as unknown as NextRequest;
}

const params = (resource: string, id?: string) =>
  ({ params: Promise.resolve(id ? { resource, id } : { resource }) }) as never;

beforeEach(() => {
  filtroRecibido = null;
  filas = [];
  filaUnica = {};
  requireTenant.mockReset();
  requireTenantWrite.mockReset();
});

describe("el listado acota por vendedor de verdad", () => {
  it("un vendedor solo pide lo suyo y lo que no es de nadie", async () => {
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    const res = await listar(peticion("https://x.test/api/erp/order"), params("order"));
    expect(res.status).toBe(200);

    // El ámbito llega a la BASE, que es donde importa: la respuesta podría
    // venir filtrada por casualidad si la empresa solo tuviera ventas suyas.
    const partes = (filtroRecibido?._and as Record<string, unknown>[]) ?? [];
    expect(partes).toContainEqual({ _or: [{ seller: "v1" }, { seller: null }] });
  });

  it("un gerente pide sin ámbito", async () => {
    requireTenant.mockResolvedValue(ctx("manager", null));
    await listar(peticion("https://x.test/api/erp/order"), params("order"));
    expect(filtroRecibido?._and).toBeUndefined();
  });

  it("sin ficha vinculada pide solo lo que no tiene vendedor", async () => {
    // No saber quién es NO abre el ámbito: si abriera, bastaría con no vincular
    // la ficha para conservar el agujero.
    requireTenant.mockResolvedValue(ctx("seller", null));
    await listar(peticion("https://x.test/api/erp/order"), params("order"));
    const partes = (filtroRecibido?._and as Record<string, unknown>[]) ?? [];
    expect(partes).toContainEqual({ seller: null });
  });

  it("el calendario de cobros le responde 403", async () => {
    // No tiene columna de vendedor, así que no se puede acotar: sube de rango.
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    const res = await listar(peticion("https://x.test/api/erp/payment_schedule"), params("payment_schedule"));
    expect(res.status).toBe(403);
  });
});

describe("el recorte de columnas sale por la respuesta", () => {
  it("el catálogo llega sin el coste, pero llega", async () => {
    // Negar la tabla entera dejaría al vendedor sin catálogo y rompería el
    // punto de venta: se proyecta, no se bloquea.
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    filas = [{ _id: "p1", name: "Saona", base_price: 80, base_cost: 30 }];

    const res = await listar(peticion("https://x.test/api/erp/product"), params("product"));
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Saona");
    expect(body.data[0].base_price).toBe(80);
    expect("base_cost" in body.data[0]).toBe(false);
  });

  it("y un gerente lo recibe entero", async () => {
    requireTenant.mockResolvedValue(ctx("manager", null));
    filas = [{ _id: "p1", base_cost: 30 }];
    const res = await listar(peticion("https://x.test/api/erp/product"), params("product"));
    const body = await res.json();
    expect(body.data[0].base_cost).toBe(30);
  });

  it("el coste tampoco viaja dentro de una relación expandida", async () => {
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    filas = [{ _id: "b1", seller: "v1", product: { _id: "p1", name: "Saona", base_cost: 30 } }];
    const res = await listar(peticion("https://x.test/api/erp/booking"), params("booking"));
    const body = await res.json();
    expect("base_cost" in body.data[0].product).toBe(false);
  });
});

describe("el detalle por identificador", () => {
  it("la venta de otro vendedor devuelve 403", async () => {
    /**
     * El filtro del listado no protege el detalle: `tenantFindOne` solo
     * comprueba la empresa. Sin la guarda bastaba con el número de la venta de
     * un compañero —que sale impreso en cualquier voucher—.
     */
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    filaUnica = { _id: "o9", seller: "v2", total: 500 };
    const res = await detalle(peticion("https://x.test/api/erp/order/o9"), params("order", "o9"));
    expect(res.status).toBe(403);
  });

  it("la suya se abre, y recortada", async () => {
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    filaUnica = { _id: "o1", seller: "v1", product: { _id: "p1", base_cost: 30 } };
    const res = await detalle(peticion("https://x.test/api/erp/order/o1"), params("order", "o1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect("base_cost" in body.data.product).toBe(false);
  });

  it("la que no es de ningún vendedor se abre", async () => {
    // El punto de venta no sella al vendedor cuando no hay ficha: esconderla
    // sería negarle su propia venta un segundo después de hacerla.
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    filaUnica = { _id: "o2", seller: null };
    const res = await detalle(peticion("https://x.test/api/erp/order/o2"), params("order", "o2"));
    expect(res.status).toBe(200);
  });
});

describe("la exportación se lleva lo MISMO que la pantalla", () => {
  it("el archivo de un vendedor no trae el coste", async () => {
    /**
     * El listado y la exportación comparten el armador del filtro, así que no
     * pueden discrepar en las FILAS. Pero el exportador no sabe recortar
     * COLUMNAS por su cuenta: sin el recorte, el archivo se llevaba el coste de
     * cada excursión mientras la pantalla no lo enseñaba. Y nadie lo revisaría,
     * porque «lo exportó el sistema».
     */
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    filas = [{ _id: "p1", name: "Saona", base_price: 80, base_cost: 30 }];

    const res = await exportar(peticion("https://x.test/api/export/product"), params("product"));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Saona");
    expect(csv).not.toContain("30");
  });

  it("y el de un gerente sí", async () => {
    requireTenant.mockResolvedValue(ctx("manager", null));
    filas = [{ _id: "p1", name: "Saona", base_price: 80, base_cost: 30 }];
    const res = await exportar(peticion("https://x.test/api/export/product"), params("product"));
    const csv = await res.text();
    expect(csv).toContain("30");
  });

  it("y las FILAS también van acotadas", async () => {
    requireTenant.mockResolvedValue(ctx("seller", "v1"));
    await exportar(peticion("https://x.test/api/export/order"), params("order"));
    const partes = (filtroRecibido?._and as Record<string, unknown>[]) ?? [];
    expect(partes).toContainEqual({ _or: [{ seller: "v1" }, { seller: null }] });
  });
});
