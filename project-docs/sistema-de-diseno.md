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
| **Cifras** | **Space Grotesk** | `.tf-num` |
| Códigos | Geist Mono | `font-mono` |

### `.tf-num` — la clase para números

```css
.tf-num {
  font-family: var(--font-num), ui-sans-serif, sans-serif;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  letter-spacing: -0.02em;
}
```

Se aplica a **todo importe, contador, porcentaje y fecha numérica**: valores
de `KpiCard`, columnas alineadas a la derecha de `DataTable`, etiquetas de
`AreaChart`/`BarList`/`Donut`, totales del POS y píldoras con dinero.

Por qué existe: Fraunces es una serif de alto contraste y trazo grueso.
Perfecta para un titular, demasiado densa para un `US$66,709.00` a 27 px —
que es exactamente lo que se veía "muy cargado". Space Grotesk tiene cifras
geométricas de ancho uniforme, así que las columnas de importes quedan
alineadas y el peso baja de `semibold` a `500`.

Vive en `@layer components`, así que cualquier utilidad de Tailwind la gana:
si un caso concreto necesita `font-semibold` o `text-2xl`, basta añadirlo.

## Regla de las capas de cascada

Todas las clases `.tf-*` **deben** estar dentro de `@layer components`. El CSS
sin capa gana a `@layer utilities` sin importar la especificidad: cuando
`.tf-card` estaba fuera de las capas, su `background: var(--card)` anulaba
`bg-primary` y las tarjetas KPI acababan con texto blanco sobre blanco.

## Verificación

Cada par de color está medido con la fórmula de contraste WCAG 2.x
(oklch → sRGB → luminancia relativa, componiendo las opacidades). La última
auditoría en navegador recorrió 24 rutas: **0 fallos** sobre ~5 400 nodos de
texto, con el mínimo AA de 4,5:1 (3:1 para texto grande) y excluyendo los
controles deshabilitados, que la norma exime.
