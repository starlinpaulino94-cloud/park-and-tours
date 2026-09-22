import { describe, it, expect } from "vitest";
import { claimsDeToken, empresaDelToken, verificarCambioDeEmpresa } from "@/lib/token-claims";

/** Arma un JWT de mentira: firma inventada, que aquí no se verifica. */
function tokenCon(claims: Record<string, unknown>): string {
  const b64 = (s: string) =>
    Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64(JSON.stringify({ alg: "HS256" }))}.${b64(JSON.stringify(claims))}.firma-inventada`;
}

describe("las claims del token", () => {
  it("saca la empresa que trae", () => {
    expect(empresaDelToken(tokenCon({ org_id: "emp-b", app_role: "manager" }))).toBe("emp-b");
  });

  it("lee acentos sin partirlos", () => {
    // `atob` devuelve bytes latin1: sin reconstruir el UTF-8, «Excursión»
    // saldría con la ñ rota y una comparación de nombres fallaría.
    expect(claimsDeToken(tokenCon({ name: "Excursión Saoná" }))?.name).toBe("Excursión Saoná");
  });

  it("ante un token roto devuelve null en vez de reventar", () => {
    /**
     * Quien llama está decidiendo si enseñar un aviso. Una excepción aquí
     * tumbaría el cambio de empresa por un token con una coma de más.
     */
    for (const malo of [null, undefined, "", "no-es-un-jwt", "a.b", "a.b.c.d", "a.@@@.c"]) {
      expect(claimsDeToken(malo as string | null), String(malo)).toBeNull();
    }
  });

  it("un payload que no es objeto no cuenta como claims", () => {
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
    expect(claimsDeToken(`${b64('{"alg":"x"}')}.${b64("[1,2,3]")}.firma`)).toBeNull();
    expect(claimsDeToken(`${b64('{"alg":"x"}')}.${b64('"hola"')}.firma`)).toBeNull();
  });

  it("un token sin org_id no inventa una empresa", () => {
    expect(empresaDelToken(tokenCon({ app_role: "manager" }))).toBeNull();
    expect(empresaDelToken(tokenCon({ org_id: "" }))).toBeNull();
    expect(empresaDelToken(tokenCon({ org_id: 12345 }))).toBeNull();
  });
});

describe("¿el cambio de empresa aterrizó?", () => {
  it("el token trae la empresa elegida", () => {
    expect(verificarCambioDeEmpresa(tokenCon({ org_id: "emp-b" }), "emp-b")).toBe("ok");
  });

  it("el token sigue en la empresa vieja", () => {
    /**
     * ES EL FALLO QUE LA 0068 VINO A CERRAR.
     *
     * La cookie ya dice la empresa nueva. Si el token sigue en la vieja, el
     * panel lanza «dashboard organization is outside your tenant» y todo lo que
     * filtra por RLS sale vacío. Señal de que el enganche no está puesto en el
     * proyecto o de que el refresco no sirvió de nada.
     */
    expect(verificarCambioDeEmpresa(tokenCon({ org_id: "emp-a" }), "emp-b")).toBe("empresa_distinta");
  });

  it("un token ilegible NO se da por bueno", () => {
    // Callarlo devolvería al usuario justo a la pantalla rota y sin explicación.
    expect(verificarCambioDeEmpresa("basura", "emp-b")).toBe("sin_token");
    expect(verificarCambioDeEmpresa(null, "emp-b")).toBe("sin_token");
    expect(verificarCambioDeEmpresa(tokenCon({ app_role: "manager" }), "emp-b")).toBe("sin_token");
  });
});

describe("el cambio de empresa no se puede dar por bueno a ciegas", () => {
  it("el selector mira el error de `refreshSession` y comprueba el token", async () => {
    /**
     * LA GUARDA QUE NACE DE UN FALLO REAL.
     *
     * `refreshSession()` NO LANZA cuando falla: devuelve `{ error }`. Envuelto
     * en un try/catch —que es como estaba—, un refresco fallido no se notaba y
     * la pantalla se recargaba igual, dejando la cookie en la empresa nueva y
     * el token en la vieja. Es decir, devolviendo al usuario al mismísimo fallo
     * que la migración 0068 vino a cerrar, y sin una sola pista de por qué.
     */
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync("src/components/tf/org-context.tsx", "utf8");

    expect(fuente, "hay que leer el `error` que devuelve refreshSession")
      .toMatch(/refreshSession\(\)/);
    expect(fuente, "el resultado de refreshSession se descarta sin mirarlo")
      .toMatch(/(const|let)\s*\{\s*data\s*,\s*error\s*\}\s*=\s*await\s+supabase\w*\(\)\.auth\.refreshSession\(\)/);
    expect(fuente, "hay que comprobar que el token nuevo trae la empresa elegida")
      .toMatch(/verificarCambioDeEmpresa\(/);
    expect(fuente, "si el token no aterrizó, el cambio se deshace en vez de recargar")
      .toMatch(/stop:\s*true/);
  });
});
