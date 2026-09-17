-- ═══════════════════════════════════════════════════════════════════════════
-- 0055 — LA MARCA DE LA EMPRESA EN SUS PROPIOS DOCUMENTOS
--
-- POR QUÉ, Y ESTE ES GRAVE
--
-- La pantalla de Configuración pide WhatsApp, logo, dirección, ciudad y color
-- de marca desde el principio. `/api/company` los declara editables. El tipo
-- `Company` de TypeScript los declara. Y NINGUNA de esas columnas existe en
-- `organizations`.
--
-- Esto no es el fallo silencioso de siempre —un campo que se pierde—: PostgREST
-- rechaza el UPDATE ENTERO cuando una sola columna del payload no existe. Es
-- decir, en cuanto alguien escribía su WhatsApp o pegaba la URL de su logo, el
-- guardado fallaba COMPLETO y se perdía también el nombre, el RNC y todo lo
-- demás del formulario. La única razón de que no reventara siempre es que la
-- ruta solo manda las claves presentes en el cuerpo, y el GET nunca devolvía
-- esos campos porque no existen.
--
-- El otro lado del mismo agujero: la cabecera de los PDF imprime
-- `company.address` y `company.whatsapp`. Al no existir, salían siempre vacíos,
-- y el voucher que el cliente enseña en la puerta no lleva ni el logo ni la
-- dirección de quien lo emitió.
--
-- QUÉ AÑADE
--
-- Las columnas que la aplicación lleva pidiendo desde siempre, y los textos que
-- un documento fiscal y un voucher necesitan llevar impresos. Nada más: el
-- formato de los documentos vive en `src/lib/pdf/`, y las reglas de color y
-- respaldo en `src/lib/branding.ts`, que es puro y se prueba.
-- ═══════════════════════════════════════════════════════════════════════════

alter table organizations
  -- ── lo que la UI ya pedía y no tenía dónde guardarse ─────────────────────
  add column if not exists whatsapp    text,
  add column if not exists address     text,
  add column if not exists city        text,
  add column if not exists group_name  text,
  add column if not exists notes       text,

  -- ── la marca ────────────────────────────────────────────────────────────
  add column if not exists logo_url    text,
  -- El color con el que salen los títulos y las líneas de acento de cada
  -- documento. Texto y no un tipo propio: es un dato de presentación, y un
  -- enum de colores sería una lista que hay que ampliar cada vez.
  add column if not exists brand_color text,

  -- ── lo que se imprime al pie ────────────────────────────────────────────
  --
  -- Un pie legal común a todos los documentos: el registro mercantil, la
  -- leyenda de la autoridad de turismo, lo que cada empresa tenga que poner.
  -- Sin esto había que pedirle al programador que lo añadiera al código.
  add column if not exists document_footer text,
  -- Las condiciones que van impresas en el voucher. El cliente lo enseña en la
  -- puerta y ahí es donde se discute qué incluye y qué no.
  add column if not exists voucher_terms   text,
  -- El texto legal del comprobante fiscal. En la República Dominicana cambia
  -- según el régimen de cada empresa, así que no puede estar quemado.
  add column if not exists invoice_terms   text;

-- El color se guarda siempre como `#rrggbb` en minúsculas. Aceptar cualquier
-- cadena obligaría a cada consumidor —el PDF, el correo, la página pública— a
-- defenderse por su cuenta, y el primero que se olvidara pintaría un documento
-- con un color inválido o reventaría al convertirlo.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_brand_color_check') then
    alter table organizations add constraint organizations_brand_color_check
      check (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$');
  end if;
end $$;
