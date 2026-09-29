import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

describe("la tipografía es una sola familia", () => {
  it("son dos familias, y ni una más", () => {
    /**
     * Eran cuatro: Fraunces (serif de titulares), Manrope, Space Grotesk y una
     * Space Grotesk recortada a las cifras. El serif cargaba la vista en las
     * pantallas que se miran ocho horas al día.
     *
     * La monoespaciada se queda a propósito: los códigos de reserva y los NCF
     * se leen en columna, y una proporcional rompe esa alineación.
     *
     * Esto comprobaba los nombres IMPORTADOS de `next/font/google`. Ya no se
     * importan de ahí —ver abajo—, así que ahora se cuentan las familias
     * declaradas, que es lo que la guarda protegía de verdad: que no vuelva a
     * colarse una tercera.
     */
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const variables = [...layout.matchAll(/variable:\s*"(--font-[\w-]+)"/g)].map((m) => m[1]);
    expect(variables.sort(), "familias declaradas en el layout")
      .toEqual(["--font-geist-mono", "--font-manrope"]);
  });

  it("el build no sale a Internet a buscar la tipografía", () => {
    /**
     * ────────────────────────────────────────────────────────────────────────
     * DE DÓNDE SALE ESTA GUARDA
     *
     * `next/font/google` DESCARGA la tipografía durante el `build` y parsea el
     * CSS que le devuelven, así que cada compilación dependía de que Google
     * contestara. El 29-sep eso tumbó el CI con un error que no menciona la red:
     *
     *     An error occurred in `next/font`.
     *     TypeError: Cannot read properties of null (reading '1')
     *         at …/@next/font/dist/google/loader.js:122:78
     *
     * —la expresión regular que parsea el CSS, sin casar—. El mismo commit pasó
     * al relanzarlo sin tocar nada.
     *
     * Se mira TODO `src`, no solo el layout: el día que alguien añada una fuente
     * en otra pantalla, la dependencia de red vuelve entera.
     */
    const culpables: string[] = [];
    const pila = ["src"];
    while (pila.length) {
      const dir = pila.pop()!;
      for (const nombre of readdirSync(dir)) {
        const ruta = path.join(dir, nombre);
        if (statSync(ruta).isDirectory()) { pila.push(ruta); continue; }
        if (!/\.tsx?$/.test(ruta)) continue;
        const texto = readFileSync(ruta, "utf8");
        // La prueba NOMBRA el módulo para explicarlo; no lo importa.
        if (/^\s*import[^;]*from\s*"next\/font\/google"/m.test(texto)) {
          culpables.push(ruta.replace(/\\/g, "/"));
        }
      }
    }
    expect(culpables, "el build vuelve a depender de que Google conteste").toEqual([]);
  });

  it("cada fichero de tipografía existe, es woff2 y alguien lo usa", () => {
    /**
     * Las tres mitades del trato, y ninguna sobra:
     *
     *  · Una ruta mal escrita en `src:` no la caza el type-check: revienta el
     *    build, que es donde menos falta hace enterarse.
     *  · Un fichero corrupto o guardado como texto compila y se rompe en el
     *    navegador, en silencio.
     *  · Y al revés: `space-grotesk-latin-var.woff2` llevaba desde la limpieza
     *    de tipografías en el repositorio sin que NADA lo nombrara. Un binario
     *    huérfano no molesta hasta que alguien lo da por vivo.
     */
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const declarados = [...layout.matchAll(/src:\s*"\.\/fonts\/([\w.-]+)"/g)].map((m) => m[1]);
    // Piso: dos familias, dos ficheros. Con el lector roto esto queda vacío y
    // todo lo de abajo pasaría sin mirar un solo byte.
    expect(declarados.length, "el layout ya no declara ninguna tipografía propia").toBe(2);

    for (const fichero of declarados) {
      const ruta = path.join("src/app/fonts", fichero);
      expect(existsSync(ruta), `declarado y no está: ${ruta}`).toBe(true);
      // `wOF2` es la firma de un WOFF2. Un fichero guardado como texto —o a
      // medio bajar— pasa cualquier comprobación de nombre y rompe la página.
      expect(readFileSync(ruta).subarray(0, 4).toString("latin1"), `${ruta} no es un WOFF2`)
        .toBe("wOF2");
    }

    const enDisco = readdirSync("src/app/fonts").filter((f) => f.endsWith(".woff2"));
    expect(enDisco.length, "no se leyó el directorio de tipografías").toBeGreaterThan(0);
    const huerfanos = enDisco.filter((f) => !declarados.includes(f));
    expect(huerfanos, "binarios que no usa nadie").toEqual([]);
  });

  it("los tres tokens de texto apuntan a la misma familia", () => {
    // Si `--font-display` vuelve a apuntar a otra cosa, los ~90 sitios que usan
    // `font-display` cambian de golpe sin que nadie los mire.
    const css = readFileSync("src/app/globals.css", "utf8");
    for (const token of ["--font-sans", "--font-display", "--font-num"]) {
      const valor = new RegExp(`${token}:\\s*([^;]+);`).exec(css)?.[1];
      expect(valor, `${token} no está definido`).toBeTruthy();
      expect(valor!, `${token} apunta a otra familia`).toContain("--font-manrope");
      expect(valor!, `${token} arrastra un serif`).not.toMatch(/(?<!sans-)serif/);
    }
  });

  it("las cifras se alinean por propiedad CSS, no por otra fuente", () => {
    // Es lo que justificaba la fuente aparte, y se consigue sin descargarla.
    const css = readFileSync("src/app/globals.css", "utf8");
    const bloque = /\.tf-num\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(bloque, ".tf-num perdió las cifras tabulares").toMatch(/tabular-nums/);
    expect(bloque, ".tf-num vuelve a cambiar de familia").not.toMatch(/font-family/);
  });
});

describe("un cupo sin calcular no es un agotado", () => {
  it("ninguna pantalla ni ruta convierte `available_pax` en cero", () => {
    /**
     * LA GUARDA QUE NACE DE LA CAPTURA DEL USUARIO.
     *
     * `available_pax` es una caché que rellena `availability.ts`. Cuando falta
     * —una salida creada por SQL, una importación—, `available_pax ?? 0` la
     * convierte en «agotado»: el catálogo entero sale con «0 plazas» en rojo y
     * al añadir algo salta «Solo quedan 0 plazas», con las salidas vacías.
     *
     * Quien necesite el número, que pase por `plazas.ts`, que distingue el
     * hueco del cero.
     */
    // Lo que hacía `grep -rn 'available_pax ?? 0' src/`, recorrido con Node
    // porque `grep` no existe en Windows: `ruta:línea:texto`, igual que grep.
    const lineas: string[] = [];
    const pila = ["src"];
    while (pila.length) {
      const dir = pila.pop()!;
      for (const nombre of readdirSync(dir)) {
        const ruta = path.join(dir, nombre);
        if (statSync(ruta).isDirectory()) { pila.push(ruta); continue; }
        readFileSync(ruta, "utf8").split("\n").forEach((texto, i) => {
          if (texto.includes("available_pax ?? 0"))
            lineas.push(`${ruta.replace(/\\/g, "/")}:${i + 1}:${texto}`);
        });
      }
    }
    const culpables = lineas
      // Las pruebas y los comentarios NOMBRAN el defecto para explicarlo; no lo
      // cometen. Sin esto la guarda se dispararía con su propia explicación.
      .filter((l) => !/\.test\.tsx?:/.test(l))
      .filter((l) => !/:\d+:\s*(\*|\/\/)/.test(l));
    expect(culpables, "sitios que dan por agotado un cupo que no se ha calculado").toEqual([]);
  });
});
