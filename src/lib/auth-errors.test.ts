import { describe, it, expect } from "vitest";
import { describeAuthError } from "@/lib/auth-errors";

/**
 * EL MENSAJE DE LA PUERTA.
 *
 * Es la única pantalla que ve alguien que no ha entrado todavía, y la única
 * pista que tiene. Un mensaje que inventa la causa —o que llega en inglés—
 * manda a buscar el problema donde no está.
 */

describe("cuando no se puede entrar", () => {
  it("no afirma una causa que no conoce", () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * LA REGLA QUE ESTA PRUEBA DEFIENDE
     *
     * `invalid_credentials` es la MISMA respuesta para tres cosas distintas:
     * la cuenta no existe aquí, la contraseña no es esa, o la cuenta quedó en
     * otro proyecto. El proveedor las junta a propósito, para que el
     * formulario no sirva para averiguar qué correos existen.
     *
     * El mensaje que había elegía una —«verifica que la cuenta exista en este
     * proyecto»— y la daba por cierta. En el caso corriente, una contraseña
     * mal tecleada, eso manda a revisar la base de datos.
     */
    const r = describeAuthError({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 })!;

    expect(r.message).not.toMatch(/proyecto|ambiente|no existe/i);
    expect(r.message, "dice lo único que se sabe").toMatch(/no coinciden/i);
    expect(r.offerReset, "y ofrece lo único que se puede hacer sin adivinar").toBe(true);
  });

  it("lo reconoce también sin código, por el texto", () => {
    // Las versiones viejas del cliente no traen `code`. Caer al mensaje crudo
    // en inglés sería peor que reconocerlo por el texto.
    const r = describeAuthError({ message: "Invalid login credentials" })!;
    expect(r.message).toMatch(/no coinciden/i);
  });

  it("un email sin confirmar SÍ se distingue, porque no es ambiguo", () => {
    // Aquí el proveedor ya dijo que la cuenta existe: ocultarlo no protege
    // nada y deja a la persona probando contraseñas que son correctas.
    const r = describeAuthError({ code: "email_not_confirmed" })!;
    expect(r.message).toMatch(/no está confirmado/i);
    expect(r.offerReset, "restablecer la contraseña no arregla una confirmación").toBe(false);
  });

  it("a quien está frenado por intentos no se le ofrece restablecer", () => {
    // Mandarlo a pedir un correo sólo suma otra petición al mismo límite.
    const r = describeAuthError({ status: 429, message: "Request rate limit reached" })!;
    expect(r.message).toMatch(/demasiados intentos/i);
    expect(r.offerReset).toBe(false);
  });

  it("una cuenta bloqueada no se confunde con una contraseña mala", () => {
    const r = describeAuthError({ code: "user_banned" })!;
    expect(r.message).toMatch(/bloqueada/i);
  });

  it("el servidor inalcanzable no se cuenta como credenciales malas", () => {
    /**
     * Sin red no hay respuesta, así que no hay `status`. Enseñar «email o
     * contraseña incorrectos» ahí hace que alguien cambie una contraseña que
     * estaba bien.
     */
    const r = describeAuthError({ message: "TypeError: Failed to fetch" })!;
    expect(r.message).toMatch(/conexión|contactar/i);
    expect(r.message).not.toMatch(/contraseña/i);
  });

  it("nunca deja pasar un mensaje en inglés", () => {
    for (const error of [
      { code: "invalid_credentials", message: "Invalid login credentials" },
      { code: "email_not_confirmed", message: "Email not confirmed" },
      { code: "weak_password", message: "Password should be at least 8 characters" },
      { message: "Something nobody mapped" },
      { status: 500, message: "Internal Server Error" },
    ]) {
      const r = describeAuthError(error)!;
      expect(r.message, `sin traducir: ${error.message}`).not.toBe(error.message);
      expect(r.message).toMatch(/[áéíóúñ¿«]/);
    }
  });

  it("sin error no hay mensaje", () => {
    // Pintar una alerta roja después de un acceso correcto es el fallo que
    // esta rama evita.
    expect(describeAuthError(null)).toBeNull();
    expect(describeAuthError(undefined)).toBeNull();
  });
});
