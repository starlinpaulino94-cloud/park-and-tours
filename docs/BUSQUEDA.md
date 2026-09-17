# Buscar como busca una persona

## El fallo, que pasaba varias veces al día

La búsqueda de todos los listados hacía `ilike '%lo que escribiste%'` contra cada
campo **por separado**. Tres consecuencias, y las tres se sufren en el mostrador
con un cliente delante:

1. **Los acentos importaban.** Quien teclea rápido —o desde un teclado sin
   acentos, que es la mitad de los móviles— escribe «jose perez» y no encontraba
   a «José Pérez». La ficha existe y el sistema dice que no. Y entonces alguien
   la crea otra vez, y ya hay dos.
2. **El orden importaba.** «pérez josé» tampoco la encontraba, porque ningún
   campo suelto contiene esa cadena.
3. **Cada búsqueda leía la tabla entera.** Un `LIKE` que empieza por comodín no
   puede usar un índice normal. Con dos mil clientes no se nota; con veinte mil,
   el buscador tarda lo suficiente como para que nadie lo use.

Y había un cuarto, más callado: el código escapaba los metacaracteres de
**expresión regular** —que en un `LIKE` no significan nada— y dejaba sin escapar
los dos que **sí** son comodines. Buscar `%` devolvía la tabla entera.

---

## Cómo funciona ahora

Una **columna generada** que Postgres calcula y mantiene él: todos los campos
buscables de la fila, juntos, en minúsculas y sin acentos.

Lo que se escribe se parte en **palabras** y se exigen **todas**. Eso hace que el
orden deje de importar, y evita el falso positivo del camino contrario: buscar
«ana maria» y que salga todo el que se llame Ana.

| Tabla | Qué entra en la columna |
|---|---|
| `customer` | Nombre, apellido, correo, teléfono, documento |
| `seller` | Nombre, apellido, código comercial, correo, teléfono |
| `product` | Nombre, código, ubicación |
| `supplier` | Nombre, RNC, contacto, correo |

Las demás tablas siguen buscando campo por campo. Añadirle una columna generada
a las ochenta sería una migración enorme para arreglar un problema que solo duele
donde hay **nombres propios** — ahí sí se escapan ya los comodines.

---

## Por qué una columna generada y no un disparador

MEMBEGO resuelve esto mismo con una columna que mantiene un disparador, y su
propia documentación avisa: *«si te llevas `Vendedor`, llévate el disparador — y
el índice GIN que lo acompaña»*.

Una columna generada no tiene esa trampa, porque no hay nada que llevarse:

- no hay disparador que escribir;
- no hay respaldo que rellenar (nace calculada en las filas que ya existían);
- **nadie puede escribirla** — Postgres rechaza el intento, así que no hay forma
  de que un camino de escritura nuevo la deje mintiendo;
- y se recalcula al **editar**, que es donde una columna mantenida a mano se
  olvida y deja fichas que se encuentran por su nombre viejo.

## Por qué `translate` y no la extensión `unaccent`

Porque `unaccent()` es `STABLE` y no `IMMUTABLE`, y una columna generada solo
admite expresiones inmutables: Postgres rechazaría la columna entera.

Y de paso se gana algo. `translate` con una lista explícita hace exactamente lo
que dice, en cualquier instalación, sin depender de un diccionario que puede no
estar instalado ni ser el mismo en dos servidores.

La lista cubre el español y lo que llega de los pasaportes que pasan por una
operadora dominicana: francés, portugués, italiano y alemán. Un turista se llama
«Müller» o «Gonçalves», y su ficha la teclea alguien que no tiene esas letras a
mano.

---

## Los dos lados tienen que decir lo mismo

La columna la calcula Postgres (`app.search_normalize`); lo que el usuario
escribe lo normaliza TypeScript (`normalizeSearch`). **Si las dos tablas de
caracteres se separan, la búsqueda deja de encontrar lo que hay guardado** — y no
da error: devuelve cero resultados, que es exactamente lo que parece «no existe».

Por eso hay una prueba que lee la cadena de la migración y la compara con la de
TypeScript, carácter a carácter. Una letra de más en un lado desplazaría todas
las siguientes: la «ñ» pasaría a ser otra cosa y nadie lo vería hasta que un
Núñez no aparece.

---

## Lo que esto destapó en el banco de pruebas

Al probar la normalización contra Postgres de verdad, la primera ejecución
devolvió `josao paorez` en vez de `jose perez`.

No era la migración: era el **banco de pruebas**. `initdb` heredaba la
configuración regional del contenedor —que es `C`— y creaba la base en
**SQL_ASCII**, donde Postgres trata cada carácter multibyte como bytes sueltos.

Producción es UTF-8. Una prueba que corre con otra codificación comprueba otra
base, y justo el día que importa dice que todo está bien. `scripts/db-test.sh`
ahora fuerza `--encoding=UTF8` explícitamente, para **todas** las migraciones, no
solo para esta.

---

## Dónde vive el código

| Qué | Dónde |
|---|---|
| Normalizar, partir en palabras y armar el filtro (puro) | `src/lib/search.ts` |
| Donde se aplica a todos los listados y a su exportación | `src/lib/erp-query.ts` |
| La columna generada, la función y los índices | `supabase/migrations/0062_accent_insensitive_search.sql` |
| Que los dos lados digan lo mismo | `src/lib/search.test.ts` |
| Que Postgres haga con eso lo que se espera | `supabase/tests/search_normalize.test.sql` |
