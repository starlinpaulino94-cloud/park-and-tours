import { describe, it, expect } from "vitest";
import { WORKSPACES, workspaceLanding, canSeeWorkspace, LEGACY_HUB_REDIRECTS } from "./nav";

/**
 * Regresión: los workspaces cuya página llama `enterWorkspace()` no pueden
 * redirigir a su propia URL — sería un bucle infinito. `inicio` queda fuera
 * porque `/dashboard` es una página real, no una redirección.
 */
const REDIRECTING = ["comercial","operaciones","parque","comercio","clientes",
                     "finanzas","analitica","equipo","administracion"];
const ROLES = ["owner","admin","manager","operations","cashier","seller"];
const MODULE_SETS: (string[] | null)[] = [null, [], ["bookings"], ["bookings","payments"], ["accounting"], ["reports"]];
const TYPES = ["park","excursion_company","tour_operator","agency","transport","other"];

describe("enterWorkspace — protección de bucle", () => {
  it("un workspace visible nunca aterriza en su propia URL", () => {
    const loops: string[] = [];
    for (const w of WORKSPACES.filter((x) => REDIRECTING.includes(x.slug)))
      for (const role of ROLES)
        for (const modules of MODULE_SETS)
          for (const companyType of TYPES) {
            const ctx = { role, modules, companyType };
            // enterWorkspace sólo continúa si el workspace es visible
            if (!canSeeWorkspace(w, ctx)) continue;
            if (workspaceLanding(w, ctx) === w.href) {
              loops.push(`${w.slug} · ${role} · ${JSON.stringify(modules)} · ${companyType}`);
            }
          }
    expect(loops).toEqual([]);
  });

  it("canSeeWorkspace es falso exactamente cuando no hay destino distinto", () => {
    // Si el workspace NO es visible, enterWorkspace debe cortar antes de
    // redirigir: es el caso que producía el bucle.
    let invisiblesConLandingPropio = 0;
    for (const w of WORKSPACES.filter((x) => REDIRECTING.includes(x.slug)))
      for (const role of ROLES)
        for (const modules of MODULE_SETS) {
          const ctx = { role, modules, companyType: "park" };
          if (!canSeeWorkspace(w, ctx) && workspaceLanding(w, ctx) === w.href) invisiblesConLandingPropio++;
        }
    // Existen: por eso enterWorkspace comprueba canSeeWorkspace antes.
    expect(invisiblesConLandingPropio).toBeGreaterThan(0);
  });

  it("todo destino heredado apunta a un workspace existente", () => {
    const slugs = WORKSPACES.map((w) => w.slug);
    for (const slug of Object.values(LEGACY_HUB_REDIRECTS)) expect(slugs).toContain(slug);
  });
});
