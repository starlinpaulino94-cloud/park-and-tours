import { describe, it, expect } from "vitest";
import {
  assignableRoles, canAssign, roleDecision, normalizeEmail, isEmail,
  memberState, MEMBER_STATE_LABEL, passwordIssue, MIN_PASSWORD, safeNextPath,
} from "@/lib/team";

/**
 * La prueba central de este archivo es la primera: NADIE OTORGA UN ROL POR
 * ENCIMA DEL SUYO. Sin esa regla, cualquier administrador podía crear una
 * cuenta de propietario con una contraseña elegida por él y entrar con ella —y
 * la guarda que impedía cambiarse el propio rol daba la impresión de que el
 * asunto estaba cubierto.
 */

describe("quién puede otorgar qué rol", () => {
  it("un administrador NO puede nombrar propietarios", () => {
    expect(canAssign("admin", "owner")).toBe(false);
    const decision = roleDecision("admin", "owner");
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(403);
    // Y el mensaje dice qué hacer, no solo que no se puede.
    expect(decision.message).toMatch(/por encima|pídeselo/i);
  });

  it("un gerente no nombra administradores", () => {
    expect(canAssign("manager", "admin")).toBe(false);
    expect(canAssign("manager", "operations")).toBe(true);
  });

  it("un propietario puede nombrar a otro propietario", () => {
    // Una empresa con un solo dueño y sin relevo es un problema de
    // continuidad, no una medida de seguridad.
    expect(canAssign("owner", "owner")).toBe(true);
  });

  it("cada rol se alcanza a sí mismo y a los de abajo", () => {
    expect(assignableRoles("manager")).toEqual(["manager", "operations", "cashier", "seller", "partner"]);
    expect(assignableRoles("seller")).toEqual(["seller", "partner"]);
  });

  it("un rol desconocido no otorga nada", () => {
    // Fallar hacia el silencio: un rol mal escrito no puede convertirse en
    // «puede todo».
    expect(assignableRoles("marciano")).toEqual([]);
    expect(roleDecision("marciano", "seller").ok).toBe(false);
  });

  it("un rol inventado se rechaza como dato inválido, no como permiso", () => {
    const decision = roleDecision("owner", "jefe_supremo");
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(400);
  });

  it("sin rol no se asume ninguno", () => {
    expect(roleDecision("owner", "").ok).toBe(false);
    expect(roleDecision("owner", undefined).ok).toBe(false);
  });
});

describe("el correo", () => {
  it("se normaliza como lo guarda Supabase", () => {
    // Sin esto, «Juan@Empresa.com » crea una cuenta distinta de «juan@empresa.com».
    expect(normalizeEmail("  Juan@Empresa.COM ")).toBe("juan@empresa.com");
    expect(normalizeEmail(undefined)).toBe("");
  });

  it("descarta lo que no puede ser una dirección", () => {
    expect(isEmail("juan@empresa.com")).toBe(true);
    expect(isEmail("juan+reservas@empresa.com.do")).toBe(true);
    expect(isEmail("juan")).toBe(false);
    expect(isEmail("juan@empresa")).toBe(false);
    expect(isEmail("juan @empresa.com")).toBe(false);
  });
});

describe("el estado de la cuenta", () => {
  it("«pendiente» se le enseña al administrador como «invitado»", () => {
    // Es la diferencia entre reenviar el correo y llamar por teléfono.
    expect(memberState("pending")).toBe("invited");
    expect(MEMBER_STATE_LABEL[memberState("pending")]).toBe("Invitado");
  });

  it("lo desconocido se trata como activo, no como un hueco", () => {
    expect(memberState(null)).toBe("active");
    expect(memberState("active")).toBe("active");
    expect(memberState("inactive")).toBe("inactive");
  });
});

describe("la contraseña nueva", () => {
  it("exige el mínimo de la casa", () => {
    expect(passwordIssue("corta")).toMatch(new RegExp(String(MIN_PASSWORD)));
    expect(passwordIssue("unaclavelarga")).toBeNull();
  });

  it("rechaza las primeras que alguien probaría", () => {
    expect(passwordIssue("12345678")).toMatch(/probaría/);
    expect(passwordIssue("PassWord")).toMatch(/probaría/);
  });

  it("los espacios no cuentan como longitud", () => {
    // Se copian sin verse y luego la contraseña «no entra» sin explicación.
    expect(passwordIssue("   a      ")).not.toBeNull();
  });

  it("avisa cuando las dos no coinciden, y solo entonces", () => {
    expect(passwordIssue("unaclavelarga", "otraclavelarga")).toMatch(/no coinciden/);
    expect(passwordIssue("unaclavelarga", "unaclavelarga")).toBeNull();
    // Sin confirmación no se inventa el problema: el servidor valida una sola.
    expect(passwordIssue("unaclavelarga")).toBeNull();
  });
});

describe("volver desde el correo sin salir del sistema", () => {
  it("una ruta interna se respeta", () => {
    expect(safeNextPath("/auth/establecer-clave")).toBe("/auth/establecer-clave");
    // La consulta se conserva: es parte del destino, no un añadido.
    expect(safeNextPath("/dashboard/caja?abrir=1")).toBe("/dashboard/caja?abrir=1");
  });

  it("una dirección externa no", () => {
    expect(safeNextPath("https://sitio-ajeno.com")).toBe("/dashboard");
    expect(safeNextPath("//sitio-ajeno.com")).toBe("/dashboard");
  });

  it("la barra invertida también es otro dominio", () => {
    /**
     * Es el caso que se cuela cuando solo se mira el primer carácter:
     * `new URL("/\\otro.com", "https://mi.app")` devuelve `https://otro.com/`.
     * Comprobado contra el propio resolvedor de URL, no de memoria.
     */
    expect(safeNextPath("/\\sitio-ajeno.com")).toBe("/dashboard");
    expect(new URL(safeNextPath("/\\sitio-ajeno.com"), "https://mi.app").origin).toBe("https://mi.app");
  });

  it("los caracteres de control no sirven para colarse", () => {
    // El navegador los recorta antes de interpretar el resto de la dirección.
    expect(safeNextPath("/\tsitio")).toBe("/dashboard");
    expect(safeNextPath("/\nsitio")).toBe("/dashboard");
  });

  it("sin destino, al panel", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath("dashboard")).toBe("/dashboard");
  });
});
