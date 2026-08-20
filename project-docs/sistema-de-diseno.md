# Sistema de diseño — TourFlow

Referencia rápida del color y la tipografía del sistema. Todo vive en
`src/app/globals.css`; los componentes solo consumen tokens.

## Color — azul MembeGo (matiz 255)

La rampa se tomó directamente de `membego.com`: su botón "Registrarse" es
`oklch(0.55 0.22 255)` y el sitio expone la misma escala como
`--color-primary-500…900`.

| Token | Valor | Uso |
|---|---|---|
| `--brand-600` | `oklch(0.55 0.22 255)` | **Azul MembeGo exacto**. Rellenos decorativos, `--ring` |
| `--brand-700` | `oklch(0.488 0.203 255)` | Tarjetas KPI en tono `primary` (texto blanco 6.16:1) |
| `--primary` | `oklch(0.525 0.215 255)` | Botones, enlaces, estados activos |
| `--ink` | `oklch(0.205 0.055 260)` | Navy de la barra lateral y de las tarjetas oscuras |
| `--coral` | `oklch(0.55 0.19 22)` | Importes negativos: comisiones, costes, vencido |
| `--amber` | `oklch(0.79 0.14 80)` | Efectivo en caja, avisos |
| `--azure` | `oklch(0.72 0.15 220)` | Acento secundario, series de gráficos |

`--primary` es el 600 de MembeGo un 2,5 % más oscuro. Motivo: con la
luminosidad exacta `0.55`, `text-primary` sobre el fondo `--secondary` da
4,28:1 y no llega al mínimo AA. Con `0.525` pasan las dos direcciones:
blanco sobre azul 5,41:1 y azul sobre superficie 4,75:1 en el peor caso.

`--ink`, `--coral`, `--amber` y `--sand` **no se redefinen en `.dark`** a
propósito: así las tarjetas saturadas conservan exactamente el mismo par
texto/fondo verificado en los dos temas.

Clases utilitarias disponibles: `bg-brand-50…950`, `bg-coral`, `bg-amber`,
`bg-ink`, `text-sand`, `bg-azure`.

## Tipografía

| Rol | Familia | Dónde |
|---|---|---|
| Titulares | **Fraunces** (serif editorial) | `h1`–`h3`, `.font-display` |
| Texto | **Manrope** | `body` |
| **Cifras y signos** | **Space Grotesk** | **toda la app, automático** |
| Códigos y referencias | Geist Mono | `font-mono` |

### Cómo se aplica Space Grotesk a todos los números

No hay que poner ninguna clase. La fuente se autohospeda en
`src/app/fonts/space-grotesk-latin-var.woff2` (22 KB, variable 300–700, subset
latin de Google Fonts) y se declara en `src/app/layout.tsx` con `next/font/local`
recortada por `unicode-range` a los codepoints que se leen como cifra o signo:

```
U+0023-0025  # $ %          U+00B0-00B7  ° ± ² ³ µ ·
U+0028-0029  ( )            U+00B9-00BE  ¹ ¼ ½ ¾
U+002B-003A  + , - . / 0-9 :  U+00D7 U+00F7  × ÷
U+003C-003E  < = >          U+2013-2014  – —
U+00A2-00A5  ¢ £ ¤ ¥        U+2030 U+2032-2033  ‰ ′ ″
U+20AC  €                   U+2044 U+2215  ⁄ ∕
U+2191 U+2193  ↑ ↓          U+2212  −
```

Las **letras están deliberadamente fuera** del rango. Esa familia va **primera**
en todos los stacks (`--font-sans` y `--font-display` en `globals.css`), así que
el navegador la usa para los caracteres de la lista y cae a la siguiente familia
para el resto. Resultado en un mismo nodo de texto:

```
"07:00 Saona · 86 pasajeros · 4 vehículos · 12 hoteles"
 └─ 17 glifos Space Grotesk ─┘  └─ 74 glifos Manrope ─┘
```

Dos avisos para quien toque esto:

1. **`adjustFontFallback: false` es obligatorio.** Si se quita, Next emite una
   cara de fallback con métricas ajustadas y **sin** `unicode-range`, que
   coincidiría con *todos* los caracteres y se comería el texto entero.
2. **El `unicode-range` tiene que ser un literal escrito en línea.** El cargador
   de fuentes de Next rechaza valores que no pueda evaluar estáticamente
   (`Font loader values must be explicitly written literals`), así que no se
   puede extraer a una constante.

### `.tf-num` — sigue siendo necesaria

```css
.tf-num {
  font-family: var(--font-grotesk), ui-sans-serif, sans-serif;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  letter-spacing: -0.02em;
}
```

Aplica **Space Grotesk completo, con letras incluidas**, para cadenas que son
una cifra de principio a fin: `US$5,799.00`, `RD$67,000`, `8 h`, `86 pax`. Sin
ella el `US$` saldría en Manrope y los dígitos en Space Grotesk. Además activa
cifras tabulares para que las columnas de importes queden alineadas.

Vive en `@layer components`, así que cualquier utilidad de Tailwind la gana: si
un caso concreto necesita `font-semibold` o `text-2xl`, basta añadirlo.

### Lo que se queda en monoespaciada

`font-mono` (Geist Mono) **no** recibe Space Grotesk. Es para identificadores
—`RSV-2608-86X8A`, matrículas, números de documento—, no para cifras: meter una
familia proporcional ahí rompería la alineación de columnas que justifica usar
monoespaciada. Verificado: esas celdas siguen dando 100 % Geist Mono.

## Regla de las capas de cascada

Todas las clases `.tf-*` **deben** estar dentro de `@layer components`. El CSS
sin capa gana a `@layer utilities` sin importar la especificidad: cuando
`.tf-card` estaba fuera de las capas, su `background: var(--card)` anulaba
`bg-primary` y las tarjetas KPI acababan con texto blanco sobre blanco.

## Verificación

**Color.** Cada par está medido con la fórmula de contraste WCAG 2.x
(oklch → sRGB → luminancia relativa, componiendo las opacidades). La auditoría
en navegador recorrió 24 rutas: **0 fallos** sobre ~5 400 nodos de texto, con el
mínimo AA de 4,5:1 (3:1 para texto grande) y excluyendo los controles
deshabilitados, que la norma exime.

**Tipografía.** Comprobada con `CSS.getPlatformFontsForNode` del protocolo de
DevTools, que reporta la fuente real y el número de glifos que aporta cada una
por nodo — no la propiedad CSS, sino lo que el motor dibuja. 30 rutas, 2 343
nodos con dígitos, **0 nodos numéricos sin Space Grotesk**. Reparto total de
glifos: Space Grotesk 7 644 · Manrope 6 337 · Geist Mono 1 005 (códigos) ·
Fraunces 35.

El eje variable se validó dibujando `8888` en canvas a peso 300 y 700 y contando
píxeles con tinta: **+82 %**, así que la fuente responde al peso y no está
clavada en un solo grosor. Control complementario: `abcd` en esa misma familia
da exactamente el mismo resultado que la monoespaciada del sistema, lo que
confirma que las letras caen a la familia siguiente y no las está dibujando la
cara de cifras.
