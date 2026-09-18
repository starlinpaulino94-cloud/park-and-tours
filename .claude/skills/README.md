# Skills instalados, y por qué estos y no los otros veinte

Origen: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (`c004a74`),
licencia MIT © 2025 Addy Osmani. Se copian tal cual; los cambios están al final.

El repositorio de origen trae **25 skills**. Se han instalado **cinco**. Instalar los
veinticinco sería el error que estos skills existen para evitar: cada uno inyecta su
descripción en cada sesión, varios dan recetas distintas para lo mismo, y un agente con
cinco recetas contradictorias comete MÁS errores, no menos.

---

## Los cinco, y qué problema real de este repositorio ataca cada uno

| Skill | El fallo concreto que habría evitado |
|---|---|
| **doubt-driven-development** | 0046 reescribió el enganche del token y le quitó `security definer` sin que nadie lo cuestionara. Su comentario decía «el resto queda exactamente igual» — una afirmación que nadie contrastó, y que era falsa. Este skill obliga a someter esa clase de afirmación a un revisor de contexto limpio **antes** de que se dé por buena. |
| **debugging-and-error-recovery** | El login estuvo roto y el primer instinto fue mirar el código del PR. Lo que resolvió el caso fue reproducirlo contra un Postgres efímero. Este skill hace de eso el paso 1, no el último recurso: reproducir → localizar → reducir → arreglar la causa → **guardar contra la recurrencia** → verificar de extremo a extremo. |
| **test-driven-development** | Su «Prove-It Pattern» es exactamente lo que faltó: ante un fallo, escribir primero la prueba que lo reproduce. Había una comprobación de que `supabase_auth_admin` *puede* ejecutar el enganche; no había ninguna de que al ejecutarlo funcione. |
| **observability-and-instrumentation** | Su primer paso es «define qué significa que funciona antes de instrumentar». Es la ola 8 en curso, y da criterio para no acabar con 102 `console.error` más. |
| **constraint-driven-development** | Escribe el listón de calidad del proyecto como contrato y detecta cuándo se está bajando en silencio. Este repositorio ya tiene un listón alto —migraciones idempotentes, pruebas por mutación, guardas de contrato— pero vive en la costumbre, no escrito. |

---

## Lo que NO se instaló, y por qué

**Por solaparse con lo que ya trae la herramienta** — instalar dos recetas para lo mismo
no duplica la calidad, obliga a elegir entre ellas:

- `code-review-and-quality` → ya existe `/code-review`, que además aplica los arreglos.
- `code-simplification` → ya existe `/simplify`.
- `security-and-hardening` → ya existe `/security-review`.

**Por solaparse con la práctica ya establecida aquí**, que es más específica que la
genérica: `incremental-implementation`, `planning-and-task-breakdown`,
`spec-driven-development`, `git-workflow-and-versioning`, `documentation-and-adrs`.
Este repositorio ya entrega en tajadas verificadas, con migración + dominio puro + guardas
y un commit que explica qué fallaba.

**Por no aplicar a este proyecto hoy**: `browser-testing-with-devtools` (requiere un MCP
de Chrome DevTools que esta sesión no tiene), `ci-cd-and-automation` (el CI ya está y
funciona), `deprecation-and-migration`, `api-and-interface-design`,
`performance-optimization`, `frontend-ui-engineering`, `shipping-and-launch`,
`context-engineering`, `source-driven-development`, `interview-me`, `idea-refine`,
`using-agent-skills`.

Ninguno de esos está descartado para siempre. `performance-optimization` valdrá el día
que la operadora tenga veinte mil clientes; `api-and-interface-design`, el día que la API
de socios tenga clientes de verdad que no se puedan romper.

---

## Un cambio de comportamiento que conviene saber

**`doubt-driven-development` levanta revisores de contexto limpio** (subagentes) para
cross-examinar decisiones no triviales. Eso cuesta tiempo y tokens en cada decisión
importante — y es exactamente su propósito: verificar ahora sale más barato que depurar
después. El propio skill acota cuándo NO aplica (renombrados, formateo, cambios de una
línea, instrucciones claras del usuario), para que no se convierta en dudar de cada tecla.

---

## Cambios respecto al original

Uno solo: las referencias compartidas (`observability-checklist`,
`orchestration-patterns`, `testing-patterns`) se copiaron a `.claude/references/`, que es
donde las rutas relativas de los skills las buscan desde `.claude/skills/<nombre>/`. El
texto de los skills no se ha tocado.
