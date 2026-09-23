-- 0076 · PARTE 1 — la disputa de una liquidación.
--
-- Pegar entero y ejecutar. Re-ejecutable.
--
-- `dispute_reason` ya existía desde 0040 y nadie la ha escrito nunca: la
-- columna del motivo llevaba ahí esperando a una ruta que no llegó. Se repite
-- por si acaso; lo que falta de verdad son las otras tres.
alter table settlement
  add column if not exists dispute_reason   text,
  add column if not exists disputed_at      timestamptz,
  add column if not exists disputed_by      uuid references auth.users(id) on delete set null,
  add column if not exists dispute_assignee uuid references auth.users(id) on delete set null;

comment on column settlement.dispute_assignee is
  'La persona de la operadora a la que le toca resolver esta disputa (0076). '
  'Sin destinatario, el aviso va a una audiencia de rol: todos lo ven y '
  'ninguno lo coge.';

create index if not exists settlement_disputed_idx
  on settlement (organization_id, disputed_at desc)
  where status = 'disputed';
