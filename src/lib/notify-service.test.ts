import { describe, it, expect, vi, beforeEach } from "vitest";

const insert = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({ from: () => ({ insert: (row: unknown) => insert(row) }) }),
}));

import { notify } from "@/lib/notify-service";

/**
 * Tres propiedades, y las tres existen para que un aviso no pueda hacer daño:
 * no lanza nunca, no se repite, y un aviso personal no lleva rol (ya tiene
 * nombre y apellido).
 */

beforeEach(() => {
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const rowOf = () => insert.mock.calls[0][0] as Record<string, unknown>;

describe("escribir el aviso", () => {
  it("guarda el texto, el tipo, el enlace y de qué fila habla", async () => {
    await notify({
      companyId: "org-1",
      event: "booking_cancelled",
      entityType: "booking",
      entityId: "b1",
      vars: { referencia: "BK-9" },
    });

    const row = rowOf();
    expect(row.organization_id).toBe("org-1");
    expect(row.title).toContain("BK-9");
    expect(row.notification_type).toBe("alert");
    expect(row.link).toBe("/dashboard/reservas");
    expect(row.entity_type).toBe("booking");
    expect(row.entity_id).toBe("b1");
    expect(row.read_status).toBe(false);
    expect(row.event_key).toBe("booking_cancelled");
    expect(row.dedupe_key).toContain("b1");
  });

  it("un aviso de empresa lleva rol; uno personal, no", async () => {
    // El rol es lo que decide quién lo ve en la bandeja. Ponérselo a un aviso
    // dirigido a una persona sería acotarlo dos veces y dejarlo invisible para
    // su destinatario si su rol no llegara.
    await notify({ companyId: "org-1", event: "cash_close_mismatch" });
    expect(rowOf().audience_role).toBe("manager");
    expect(rowOf().user_id).toBeNull();

    insert.mockClear();
    await notify({ companyId: "org-1", event: "quote_accepted", userId: "u9" });
    expect(rowOf().user_id).toBe("u9");
    expect(rowOf().audience_role).toBeNull();
  });
});

describe("no puede hacer daño", () => {
  it("un duplicado no es un error: es el índice haciendo su trabajo", async () => {
    // El cron vuelve a mirar las mismas deudas cada día. Registrar cada choque
    // llenaría la consola de ruido y escondería los fallos de verdad.
    insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    await notify({ companyId: "org-1", event: "receivable_overdue", entityId: "r1" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("un fallo real se registra, pero tampoco lanza", async () => {
    /**
     * Es la propiedad que permite llamarlo sin try/catch desde el cierre de
     * caja o desde una venta ya cobrada: que la base de datos esté caída no
     * puede revertir la operación que provocó el aviso.
     */
    insert.mockResolvedValue({ error: { code: "42P01", message: "no existe la tabla" } });
    await expect(notify({ companyId: "org-1", event: "invoice_voided" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("una excepción del cliente tampoco sale de aquí", async () => {
    insert.mockRejectedValue(new Error("sin red"));
    await expect(notify({ companyId: "org-1", event: "stock_low" })).resolves.toBeUndefined();
  });
});
