-- 0076 — La disputa de una liquidación, con nombre y con destinatario.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL ESTADO YA EXISTÍA Y NO SE PODÍA ALCANZAR
--
-- `settlement.status` admite `disputed` desde 0006 y la interfaz lo sabe
-- traducir. Nadie podía ponerlo: no hay ninguna ruta que lo escriba, así que un
-- tour center que no está de acuerdo con su corte del mes llama por teléfono, y
-- lo que pasa después no queda en ningún sitio.
--
-- Y `dispute_reason` TAMBIÉN existía ya, desde 0040. Nadie la ha escrito nunca:
-- la columna del motivo llevaba ahí todo este tiempo esperando a una ruta que
-- no llegó. Se repite abajo por si acaso —`if not exists` no cuesta nada— y
-- para que esta migración se lea entera sin ir a buscar la otra.
--
-- Lo que falta de verdad son las otras tres, y la última es la que convierte
-- una queja en un trámite:
--
--   `disputed_at`      cuándo. Los plazos de una liquidación se cuentan.
--   `disputed_by`      quién, del tour center. Una disputa sin firma no se
--                      puede contestar a nadie.
--   `dispute_assignee` A QUIÉN le toca resolverla, de la operadora. Es el campo
--                      que el plan pedía con esas palabras, y el que evita el
--                      final habitual: un aviso a «los administradores» que
--                      todos ven y ninguno coge.
alter table settlement
  add column if not exists dispute_reason   text,
  add column if not exists disputed_at      timestamptz,
  add column if not exists disputed_by      uuid references auth.users(id) on delete set null,
  add column if not exists dispute_assignee uuid references auth.users(id) on delete set null;

comment on column settlement.dispute_assignee is
  'La persona de la operadora a la que le toca resolver esta disputa (0076). '
  'Sin destinatario, el aviso va a una audiencia de rol: todos lo ven y '
  'ninguno lo coge.';

-- Las que están en disputa se miran juntas y son pocas: un índice parcial
-- cuesta casi nada y evita recorrer el histórico entero de liquidaciones.
create index if not exists settlement_disputed_idx
  on settlement (organization_id, disputed_at desc)
  where status = 'disputed';
