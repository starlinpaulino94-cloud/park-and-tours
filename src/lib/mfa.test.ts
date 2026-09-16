import { describe, it, expect } from "vitest";
import { mfaGate, hasVerifiedFactor, normalizeCode, isCodeComplete, factorLabel } from "@/lib/mfa";

/**
 * Un segundo factor que se puede saltar es peor que no tenerlo: quien lo activó
 * cree que está a salvo. Por eso la regla de estas pruebas es que la decisión
 * SIEMPRE se equivoque hacia pedir el código.
 */

describe("dejar pasar o pedir el código", () => {
  it("sin segundo factor, se pasa", () => {
    expect(mfaGate({ aal: "aal1" })).toBe("ok");
    expect(mfaGate({ aal: "aal1", app_metadata: { mfa_enabled: false } })).toBe("ok");
  });

  it("con segundo factor y solo contraseña, se pide el código", () => {
    // Este es el caso que da sentido a todo: la contraseña robada llega hasta
    // aquí y no pasa de aquí.
    expect(mfaGate({ aal: "aal1", app_metadata: { mfa_enabled: true } })).toBe("verify");
  });

  it("con el código ya dado, se pasa", () => {
    expect(mfaGate({ aal: "aal2", app_metadata: { mfa_enabled: true } })).toBe("ok");
  });

  it("un factor verificado basta aunque falte la marca", () => {
    // Una cuenta enrolada antes de que existiera la marca no puede quedarse sin
    // protección por un detalle de implementación.
    expect(mfaGate({ aal: "aal1" }, true)).toBe("verify");
  });

  it("un token sin nivel se trata como sin verificar", () => {
    // Fallar hacia pedir el código: si no se sabe qué nivel tiene la sesión, la
    // respuesta segura es pedirlo.
    expect(mfaGate({ app_metadata: { mfa_enabled: true } })).toBe("verify");
    expect(mfaGate({ aal: "", app_metadata: { mfa_enabled: true } })).toBe("verify");
  });

  it("sin token no hay nada que decidir", () => {
    // Quien no tiene sesión lo resuelve el middleware, no esta función.
    expect(mfaGate(null)).toBe("ok");
  });
});

describe("los factores del usuario", () => {
  it("solo cuentan los verificados", () => {
    // Un enrolamiento a medias —se generó el QR y nadie lo confirmó— dejaría a
    // la persona fuera de su propia cuenta.
    expect(hasVerifiedFactor([{ status: "unverified" }])).toBe(false);
    expect(hasVerifiedFactor([{ status: "verified" }])).toBe(true);
    expect(hasVerifiedFactor([])).toBe(false);
    expect(hasVerifiedFactor(null)).toBe(false);
  });
});

describe("el código", () => {
  it("se limpia como lo enseña la aplicación del teléfono", () => {
    // «123 456» es como se ve en pantalla, y ese espacio se copia.
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode(" 123456 ")).toBe("123456");
  });

  it("seis dígitos, ni más ni menos", () => {
    expect(isCodeComplete("123 456")).toBe(true);
    expect(isCodeComplete("12345")).toBe(false);
    expect(isCodeComplete("1234567")).toBe(false);
    expect(isCodeComplete("12345a")).toBe(false);
  });
});

describe("el nombre en la aplicación de autenticación", () => {
  it("lleva el correo: quien tiene dos empresas ve dos entradas", () => {
    expect(factorLabel("ana@tours.com")).toBe("Park & Tours (ana@tours.com)");
    expect(factorLabel(null)).toContain("cuenta");
  });
});
