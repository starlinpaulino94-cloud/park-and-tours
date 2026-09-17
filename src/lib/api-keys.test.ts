import { describe, it, expect } from "vitest";
import {
  createApiKey, hashSecret, parseToken, tokenFromHeaders, secretMatches,
  checkKey, maskedToken, KEY_PROBLEM_MESSAGE, KEY_PROBLEM_STATUS, type StoredKey,
} from "@/lib/api-keys";

/**
 * Una llave de API es una contraseña que vende en nombre de una operadora, y
 * vive en el servidor de otra empresa durante años. Estas pruebas defienden las
 * tres cosas que la hacen segura: el secreto no se guarda, la comparación no
 * filtra información, y los mensajes no le dicen a quien prueba llaves cuál
 * existe.
 */

describe("crear una llave", () => {
  it("el secreto NO queda guardado: solo su hash", () => {
    /**
     * Es la diferencia entre una filtración molesta y una catastrófica: quien
     * consiga leer la tabla —una copia de seguridad, un volcado mal guardado—
     * no obtiene llaves con las que vender en nombre de nadie.
     */
    const key = createApiKey();
    const secret = key.token.split(".")[1];
    expect(key.secretHash).not.toContain(secret);
    expect(key.secretHash).toBe(hashSecret(secret));
    expect(key.secretHash).toHaveLength(64); // SHA-256 en hexadecimal
  });

  it("lleva el entorno delante", () => {
    // Evita el accidente más común: pegar la llave de producción en el sistema
    // de pruebas del socio y descubrirlo con reservas de mentira en la
    // operación real.
    expect(createApiKey().token).toMatch(/^pt_(live|test)_/);
  });

  it("dos llaves nunca coinciden", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => createApiKey().token));
    expect(tokens.size).toBe(100);
    const prefijos = new Set(Array.from({ length: 100 }, () => createApiKey().prefix));
    expect(prefijos.size).toBe(100);
  });

  it("el secreto es largo de verdad", () => {
    // Treinta y dos bytes: no se adivina ni con toda la nube del mundo.
    expect(createApiKey().token.split(".")[1].length).toBeGreaterThanOrEqual(40);
  });
});

describe("leer el token", () => {
  it("se parte por el ÚLTIMO punto", () => {
    // El secreto es base64url y no lleva puntos, pero el prefijo podría
    // llevarlos algún día: partir por el primero dejaría de funcionar sin
    // avisar. Misma cautela que con el token de MembeGo.
    const parsed = parseToken("pt_live_a1b2c3d4.secreto")!;
    expect(parsed.prefix).toBe("a1b2c3d4");
    expect(parsed.secret).toBe("secreto");
  });

  it("lo que no tiene forma de llave se rechaza sin más", () => {
    expect(parseToken("")).toBeNull();
    expect(parseToken("Bearer algo")).toBeNull();
    expect(parseToken("pt_live_sinpunto")).toBeNull();
    expect(parseToken("pt_live_.")).toBeNull();
  });

  it("se acepta en las dos cabeceras que se usan de verdad", () => {
    const bearer = new Headers({ authorization: "Bearer pt_live_a.b" });
    expect(tokenFromHeaders(bearer)).toBe("pt_live_a.b");
    // En minúsculas también: los clientes no se ponen de acuerdo.
    expect(tokenFromHeaders(new Headers({ authorization: "bearer pt_live_a.b" }))).toBe("pt_live_a.b");
    expect(tokenFromHeaders(new Headers({ "x-api-key": "pt_live_a.b" }))).toBe("pt_live_a.b");
    expect(tokenFromHeaders(new Headers())).toBeNull();
  });
});

describe("comprobar el secreto", () => {
  it("acepta el correcto y rechaza el resto", () => {
    const hash = hashSecret("s3creto");
    expect(secretMatches("s3creto", hash)).toBe(true);
    expect(secretMatches("s3cret0", hash)).toBe(false);
    expect(secretMatches("", hash)).toBe(false);
  });

  it("un hash corrupto no revienta ni pasa", () => {
    // Una fila mal migrada no puede tumbar la API ni, peor, dejar entrar.
    expect(secretMatches("s3creto", "no-es-hexadecimal")).toBe(false);
    expect(secretMatches("s3creto", "")).toBe(false);
  });
});

describe("qué deja hacer la llave", () => {
  const key = (over: Partial<StoredKey> = {}): StoredKey => ({
    id: "k1", organization_id: "org-1", secret_hash: hashSecret("s3creto"), scope: "read", ...over,
  });

  it("una llave buena de lectura lee", () => {
    const res = checkKey(key(), "s3creto", "read");
    expect(res.ok).toBe(true);
  });

  it("una llave de lectura NO crea reservas", () => {
    const res = checkKey(key(), "s3creto", "write");
    expect(res.ok).toBe(false);
    if (res.ok === true) return;
    expect(res.problem).toBe("scope");
    // 403 y no 401: la llave es buena, lo que falta es permiso. Con 401 el
    // socio revisaría su llave durante horas.
    expect(KEY_PROBLEM_STATUS[res.problem]).toBe(403);
    expect(KEY_PROBLEM_MESSAGE[res.problem]).toMatch(/solo lectura/i);
  });

  it("una llave revocada no pasa, con cualquier alcance y para cualquier cosa", () => {
    // Lo que importa es que NO entre: revocar es lo que hace el administrador
    // cuando el servidor del socio quedó comprometido.
    for (const [scope, needed] of [["write", "write"], ["write", "read"], ["read", "read"]] as const) {
      const res = checkKey(key({ scope, revoked_at: "2026-01-01" }), "s3creto", needed);
      expect(res.ok, `${scope}→${needed}`).toBe(false);
    }
  });

  it("a una llave revocada se le dice «revocada», no «te falta alcance»", () => {
    /**
     * El orden de las comprobaciones no cambia quién entra —una revocada no
     * entra de ninguna manera—, cambia qué lee el socio. «Solo lectura» lo
     * mandaría a pedir otro alcance para una llave que ya no sirve.
     */
    const res = checkKey(key({ scope: "read", revoked_at: "2026-01-01" }), "s3creto", "write");
    expect(res.ok).toBe(false);
    if (res.ok === true) return;
    expect(res.problem).toBe("revoked");
  });

  it("un secreto equivocado es «no válida», igual que una inexistente", () => {
    // Distinguirlos le diría a quien prueba llaves cuáles existen.
    const inexistente = checkKey(null, "s3creto", "read");
    const malSecreto = checkKey(key(), "otro", "read");
    expect(inexistente.ok).toBe(false);
    expect(malSecreto.ok).toBe(false);
    if (inexistente.ok === true || malSecreto.ok === true) return;
    expect(KEY_PROBLEM_MESSAGE[inexistente.problem]).toBe(KEY_PROBLEM_MESSAGE[malSecreto.problem]);
    expect(KEY_PROBLEM_STATUS[inexistente.problem]).toBe(401);
  });
});

describe("lo que ve el administrador", () => {
  it("el prefijo basta para saber cuál está revocando", () => {
    expect(maskedToken("a1b2c3d4")).toMatch(/^pt_(live|test)_a1b2c3d4…$/);
  });
});
