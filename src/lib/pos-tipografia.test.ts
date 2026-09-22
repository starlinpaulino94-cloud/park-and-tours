import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

describe("la tipografía es una sola familia", () => {
  it("no se descargan familias decorativas", () => {
    /**
     * Eran cuatro: Fraunces (serif de titulares), Manrope, Space Grotesk y una
     * Space Grotesk recortada a las cifras. El serif cargaba la vista en las
     * pantallas que se miran ocho horas al día.
     *
     * La monoespaciada se queda a propósito: los códigos de reserva y los NCF
     * se leen en columna, y una proporcional rompe esa alineación.
     */
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const importadas = /from "next\/font\/google";/.test(layout)
      ? /import \{([^}]*)\} from "next\/font\/google"/.exec(layout)![1]
          .split(",").map((x) => x.trim()).filter(Boolean)
      : [];
    expect(importadas.sort(), "familias cargadas desde Google Fonts")
      .toEqual(["Geist_Mono", "Manrope"]);
    expect(layout, "vuelve a haber una fuente local")
      .not.toMatch(/from "next\/font\/local"/);
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
    const culpables = execSync(
      "grep -rn 'available_pax ?? 0' src/ || true",
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      // Las pruebas y los comentarios NOMBRAN el defecto para explicarlo; no lo
      // cometen. Sin esto la guarda se dispararía con su propia explicación.
      .filter((l) => !/\.test\.tsx?:/.test(l))
      .filter((l) => !/:\d+:\s*(\*|\/\/)/.test(l));
    expect(culpables, "sitios que dan por agotado un cupo que no se ha calculado").toEqual([]);
  });
});
