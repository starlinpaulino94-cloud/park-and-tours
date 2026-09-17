-- ═══════════════════════════════════════════════════════════════════════════
-- 0062 — BUSCAR «JOSE PEREZ» Y ENCONTRAR A «JOSÉ PÉREZ»
--
-- EL FALLO, QUE PASA VARIAS VECES AL DÍA
--
-- La búsqueda de todos los listados hace `ilike '%<lo que escribiste>%'` contra
-- cada campo por separado. Eso significa tres cosas, y las tres se sufren en el
-- mostrador con un cliente delante:
--
--  1. **Los acentos importan.** Quien teclea rápido —o desde un teclado sin
--     acentos, que es la mitad de los móviles— escribe «jose perez» y no
--     encuentra a «José Pérez». La ficha existe, el sistema dice que no.
--  2. **El orden importa.** «pérez josé» no encuentra a «José Pérez», porque
--     ningún campo suelto contiene esa cadena.
--  3. **Cada búsqueda lee la tabla entera.** Un `LIKE` que empieza por comodín
--     no puede usar un índice normal. Con dos mil clientes no se nota; con
--     veinte mil, el buscador tarda lo suficiente como para que nadie lo use.
--
-- ── CÓMO SE ARREGLA, Y POR QUÉ ASÍ ───────────────────────────────────────
--
-- Una columna GENERADA: Postgres la calcula y la mantiene él. No hay
-- disparador que escribir, no hay respaldo que rellenar y —lo que importa— no
-- hay forma de que se quede desfasada porque alguien olvidara actualizarla al
-- añadir un camino de escritura nuevo.
--
-- MEMBEGO resuelve esto mismo con una columna que mantiene un disparador, y su
-- documentación avisa: «si te llevas Vendedor, llévate el disparador». Una
-- columna generada no tiene esa trampa, porque no hay nada que llevarse.
--
-- ── POR QUÉ `translate` Y NO LA EXTENSIÓN `unaccent` ─────────────────────
--
-- Porque `unaccent()` es STABLE y no IMMUTABLE, y una columna generada solo
-- admite expresiones inmutables. Postgres rechazaría la columna entera.
--
-- Y de paso se gana algo: `translate` con una lista explícita hace exactamente
-- lo que dice, en cualquier instalación, sin depender de un diccionario que
-- puede no estar instalado ni ser el mismo en dos servidores.
-- ═══════════════════════════════════════════════════════════════════════════

-- Los trigramas son los que hacen que un `LIKE '%…%'` pueda usar un índice.
-- Sin esto, las columnas de abajo servirían para acertar pero no para correr.
create extension if not exists pg_trgm;

-- ── la normalización, en un solo sitio ─────────────────────────────────────
--
-- IMMUTABLE de verdad: solo usa `lower` y `translate`, que lo son. Es lo que
-- permite usarla en una columna generada, y lo que garantiza que el índice no
-- mienta.
--
-- El juego de caracteres cubre el español y, de paso, lo que llega de los
-- pasaportes que pasan por una operadora dominicana: francés, portugués,
-- italiano y alemán. Un turista se llama «Müller» o «Gonçalves» y su ficha la
-- teclea alguien que no tiene esas letras a mano.
create or replace function app.search_normalize(txt text)
returns text
language sql
immutable
as $$
  select lower(translate(
    coalesce(txt, ''),
    'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿŠšŽž',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyySsZz'
  ));
$$;

-- ── clientes ───────────────────────────────────────────────────────────────
--
-- Nombre, apellido, correo, teléfono y documento en UNA cadena: así «pérez
-- josé» encuentra a José Pérez, porque la aplicación parte lo que se escribe en
-- palabras y las exige todas contra esta misma columna.
alter table customer
  add column if not exists search_text text
  generated always as (
    app.search_normalize(
      coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
      coalesce(email::text, '') || ' ' || coalesce(phone, '') || ' ' ||
      coalesce(document_id, '')
    )
  ) stored;

create index if not exists customer_search_trgm
  on customer using gin (search_text gin_trgm_ops);

-- ── vendedores ─────────────────────────────────────────────────────────────
alter table seller
  add column if not exists search_text text
  generated always as (
    app.search_normalize(
      coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
      coalesce(code, '') || ' ' || coalesce(email::text, '') || ' ' ||
      coalesce(phone, '')
    )
  ) stored;

create index if not exists seller_search_trgm
  on seller using gin (search_text gin_trgm_ops);

-- ── productos ──────────────────────────────────────────────────────────────
--
-- Se busca menos a menudo, pero se busca mal igual: «buggie» no encuentra
-- «Buggy» y «hoyo azul» tampoco si la ficha dice «Hoyo Azul (Scape Park)».
alter table product
  add column if not exists search_text text
  generated always as (
    app.search_normalize(
      coalesce(name, '') || ' ' || coalesce(code, '') || ' ' || coalesce(location, '')
    )
  ) stored;

create index if not exists product_search_trgm
  on product using gin (search_text gin_trgm_ops);

-- ── proveedores ────────────────────────────────────────────────────────────
alter table supplier
  add column if not exists search_text text
  generated always as (
    app.search_normalize(
      coalesce(name, '') || ' ' || coalesce(tax_id, '') || ' ' ||
      coalesce(contact_name, '') || ' ' || coalesce(email::text, '')
    )
  ) stored;

create index if not exists supplier_search_trgm
  on supplier using gin (search_text gin_trgm_ops);

-- No hace falta rellenar nada: una columna generada nace calculada en todas las
-- filas que ya existen, y en las que lleguen después. Esa es toda la diferencia
-- con mantenerla a mano.
