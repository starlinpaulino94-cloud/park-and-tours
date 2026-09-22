import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

/**
 * EL CI NO PUEDE TOCAR LA BASE DE VERDAD (CI-001).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN ESTAS GUARDAS
 *
 * El E2E corría contra el proyecto de Supabase de producción, con una llave de
 * servicio. Cada pull request creaba y mantenía la empresa `e2e-tenant` en la
 * base real y reescribía la contraseña de la cuenta de pruebas. Eso ya causó un
 * incidente: una cuenta que una persona usaba dejó de dejarle entrar, en
 * silencio, porque alguien abrió un PR.
 *
 * Ahora cada corrida levanta su propia pila. Estas pruebas existen para que no
 * se vuelva atrás sin querer — y sobre todo para la trampa de abajo, que no se
 * ve mirando el fichero.
 */

interface Paso { name?: string; run?: string; uses?: string; env?: Record<string, string> }

const ci = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8")) as {
  jobs: { ci: { steps: Paso[] } };
};
const pasos = ci.jobs.ci.steps;
const indiceDe = (fragmento: string) =>
  pasos.findIndex((p) => `${p.name ?? ""} ${p.run ?? ""} ${p.uses ?? ""}`.includes(fragmento));

describe("el aislamiento del CI", () => {
  it("ningún paso recibe credenciales del proyecto de producción", () => {
    /**
     * La comprobación es sobre el fichero entero y no solo sobre el paso del
     * E2E: una llave de servicio pasada a CUALQUIER paso está en el runner, y
     * de ahí a la base real hay una línea de `run`.
     */
    const culpables: string[] = [];
    for (const paso of pasos) {
      for (const [clave, valor] of Object.entries(paso.env ?? {})) {
        if (/secrets\./.test(String(valor))) culpables.push(`${paso.name ?? "(sin nombre)"}: ${clave}`);
      }
    }
    expect(culpables, "pasos que reciben secretos del repositorio").toEqual([]);
  });

  it("levanta su propia pila y la apaga pase lo que pase", () => {
    expect(indiceDe("supabase start"), "no se levanta ninguna pila local").toBeGreaterThan(-1);
    const apagado = pasos.find((p) => (p.run ?? "").includes("supabase stop"));
    expect(apagado, "no se apaga la pila").toBeTruthy();
    // Sin `if: always()`, un E2E en rojo deja los contenedores en pie.
    expect((apagado as unknown as { if?: string }).if, "el apagado tiene que correr siempre")
      .toBe("always()");
  });

  it("COMPILA DESPUÉS de levantar la pila, no antes", () => {
    /**
     * LA TRAMPA QUE NO SE VE MIRANDO EL FICHERO.
     *
     * Las variables `NEXT_PUBLIC_*` no se leen en tiempo de ejecución: Next las
     * INCRUSTA en el paquete del navegador al compilar. Con el build antes de
     * levantar la pila —que es como estaba—, el navegador del E2E habría
     * iniciado sesión contra el proyecto que se compiló, por mucho que el
     * servidor tuviera la pila local en su entorno.
     *
     * O sea: el aislamiento entero no habría servido de nada, y nada lo habría
     * dicho. El E2E habría pasado en verde escribiendo en producción.
     */
    const arranque = indiceDe("supabase start");
    const build = pasos.findIndex((p) => (p.run ?? "").includes("npm run build"));
    expect(build, "no hay paso de build").toBeGreaterThan(-1);
    expect(build, "el build compila antes de existir la pila local: el navegador iría a otra base")
      .toBeGreaterThan(arranque);
  });

  it("el build y el E2E apuntan a la pila local, no a una URL suelta", () => {
    for (const fragmento of ["npm run build", "npm run test:e2e"]) {
      const paso = pasos.find((p) => (p.run ?? "").includes(fragmento))!;
      expect(paso, fragmento).toBeTruthy();
      expect(paso.env?.NEXT_PUBLIC_SUPABASE_URL, `${fragmento}: la URL no sale de la pila local`)
        .toMatch(/env\.API_URL/);
    }
  });

  it("el E2E corre con la RLS puesta", () => {
    // Con la RLS apagada el CI daría por buenas consultas que en producción
    // devuelven vacío: probaría otra aplicación.
    const e2e = pasos.find((p) => (p.run ?? "").includes("npm run test:e2e"))!;
    expect(String(e2e.env?.SUPABASE_USE_RLS)).toBe("true");
  });

  it("el enganche del token está configurado en la pila local", () => {
    /**
     * Sin él, el token local no lleva `org_id`, `getTenantContext()` devuelve
     * null y el panel rebota a /login: el E2E fallaría con un «Timeout» que no
     * explica nada.
     */
    const config = readFileSync("supabase/config.toml", "utf8");

    // DENTRO de su sección, no en cualquier parte del fichero: `enabled = true`
    // suelto casa con el de `[api]` y la guarda daría por bueno un enganche
    // apagado, que es justo el caso que hay que cazar.
    const seccion = /\[auth\.hook\.custom_access_token\]([\s\S]*?)(?=\n\[|$)/.exec(config)?.[1];
    expect(seccion, "no hay sección del enganche en la pila local").toBeTruthy();
    expect(seccion!, "el enganche está apagado").toMatch(/^\s*enabled\s*=\s*true\s*$/m);
    expect(seccion!, "el enganche no apunta a la función de la aplicación")
      .toMatch(/uri\s*=\s*"pg-functions:\/\/postgres\/app\/custom_access_token_hook"/);
  });
});
