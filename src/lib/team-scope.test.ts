import { describe, it, expect } from "vitest";
import {
  ambitoDeLectura, ambitoDeEscritura,
  partnerRolePedido, assertNoSeQuedaSinAdmin, type Actor,
} from "@/lib/team-scope";
// Vive en `tenant.ts` desde la Fase 5: lo pregunta también el recorte de
// columnas, y ése no puede depender del módulo del equipo.
import { esAdminDeSocio } from "@/lib/tenant";

const socio = (partnerRole: string | null): Actor => ({
  role: "partner", companyId: "op-1", partnerId: "soc-1",
  isPartnerMember: true, partnerRole,
});
const interno = (role: Actor["role"]): Actor => ({ role, companyId: "op-1", partnerId: null });

describe("el ámbito del equipo no es un sí/no, es un «sobre esto»", () => {
  it("el socio lee a los suyos y solo a los suyos", () => {
    /**
     * Devolver el ámbito y no un booleano es la diferencia entre una regla que
     * se aplica y una que hay que acordarse de aplicar. Los demás tour centers
     * de la red son su competencia directa: una lista de equipo sin acotar les
     * daría los nombres y los correos de todos ellos.
     */
    expect(ambitoDeLectura(socio("agent"))).toEqual({ organizationId: "soc-1", esSocio: true });
    expect(ambitoDeLectura(socio("admin"))).toEqual({ organizationId: "soc-1", esSocio: true });
  });

  it("y leer no exige administrar", () => {
    // Saber quién de tu propia empresa tiene acceso no es una facultad de
    // gestión. Ocultárselo solo conseguiría que las cuentas de quien se fue
    // sigan abiertas porque nadie las ve.
    expect(() => ambitoDeLectura(socio("agent"))).not.toThrow();
    expect(() => ambitoDeEscritura(socio("agent"))).toThrow(/administra la cuenta de tu empresa/);
  });

  it("el personal interno abarca la operadora y sus tour centers", () => {
    expect(ambitoDeLectura(interno("manager"))).toEqual({ organizationId: null, esSocio: false });
    expect(() => ambitoDeLectura(interno("seller"))).toThrow(/permisos/);
  });

  it("escribir exige administrador en los dos lados", () => {
    expect(ambitoDeEscritura(socio("admin"))).toEqual({ organizationId: "soc-1", esSocio: true });
    expect(ambitoDeEscritura(interno("admin"))).toEqual({ organizationId: null, esSocio: false });
    expect(() => ambitoDeEscritura(interno("manager"))).toThrow(/permisos/);
  });

  it("un socio sin identificador no abre nada", () => {
    // Falla cerrado: `esDeSocio` es cierto por el nombre del rol aunque el
    // identificador no haya llegado, y sin él no hay ninguna organización a la
    // que acotar. Sin esta rama, el ámbito saldría `{organizationId: null}` —el
    // del personal interno— y el socio vería el equipo entero de la operadora.
    const sinId: Actor = { role: "partner", companyId: "op-1", partnerId: null };
    expect(() => ambitoDeLectura(sinId)).toThrow(/no está asociado/);
    expect(() => ambitoDeEscritura(sinId)).toThrow();
  });

  it("esAdminDeSocio no confunde el rol de la aplicación con la jerarquía interna", () => {
    // `admin` de la operadora NO es administrador de ningún socio.
    expect(esAdminDeSocio({ role: "admin", partnerRole: "admin" })).toBe(false);
    expect(esAdminDeSocio(socio("admin"))).toBe(true);
  });
});

describe("la jerarquía que se otorga", () => {
  it("por defecto, la que menos puede", () => {
    // Un campo ausente o con basura no puede acabar creando administradores.
    for (const valor of [undefined, null, "", "owner", "Admin", 1, {}]) {
      expect(partnerRolePedido(valor), String(valor)).toBe("agent");
    }
    expect(partnerRolePedido("admin")).toBe("admin");
  });
});

describe("ningún tour center se queda encerrado fuera de su gestión", () => {
  const base = { esSocio: true, esUnoMismo: true, administradoresActivos: 1 };

  it("el último administrador no puede bajarse a agente", () => {
    expect(() => assertNoSeQuedaSinAdmin({ ...base, nuevoPartnerRole: "agent" }))
      .toThrow(/única persona que administra/);
  });

  it("ni desactivarse", () => {
    // Es el mismo agujero por otro camino, y el que más fácil se olvida.
    expect(() => assertNoSeQuedaSinAdmin({ ...base, nuevoStatus: "inactive" }))
      .toThrow(/única persona que administra/);
  });

  it("si hay otro, sí", () => {
    expect(() => assertNoSeQuedaSinAdmin({
      ...base, administradoresActivos: 2, nuevoPartnerRole: "agent",
    })).not.toThrow();
  });

  it("y un cambio que no le quita el mando no se bloquea", () => {
    // Editar el teléfono del único administrador no puede fallar con «nombra a
    // otro antes de quitarte el permiso».
    expect(() => assertNoSeQuedaSinAdmin(base)).not.toThrow();
    expect(() => assertNoSeQuedaSinAdmin({ ...base, nuevoStatus: "active" })).not.toThrow();
  });

  it("no se mete donde no le llaman", () => {
    expect(() => assertNoSeQuedaSinAdmin({
      ...base, esSocio: false, nuevoStatus: "inactive",
    })).not.toThrow();
    expect(() => assertNoSeQuedaSinAdmin({
      ...base, esUnoMismo: false, nuevoPartnerRole: "agent",
    })).not.toThrow();
  });
});
