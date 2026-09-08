-- ============================================================================
-- 0031 — Condiciones comerciales del partner
--
-- `organization_relationships` guarda desde 0002 la comisión, el límite y los
-- días de crédito y la vigencia del contrato de cada partner —el comentario del
-- esquema es explícito: "partner-only attributes live on
-- organization_relationships, not here"—, pero ninguna parte de la aplicación
-- llegó a escribirla: el traductor borraba esos campos del payload. El límite de
-- crédito volvía siempre en cero, y con él `credit_available` del portal B2B y
-- la marca de "sobre el límite" del informe de antigüedad.
--
-- Esta migración solo alinea el dominio del tipo de relación con el que ofrece
-- la UI, para que el campo del formulario y la columna sean el mismo dato:
-- faltaba 'ota' en la base. `src/lib/domain-values.test.ts` mantiene los dos
-- lados enlazados a partir de aquí.
-- ============================================================================

alter table organization_relationships
  drop constraint if exists organization_relationships_relationship_type_check;

alter table organization_relationships
  add constraint organization_relationships_relationship_type_check
  check (relationship_type in
    ('distributor','subagency','tour_operator','reseller','hotel','agency','tour_center','ota'));

-- La relación se busca siempre por la pareja (inquilino, partner).
create index if not exists org_rel_pair_idx
  on organization_relationships (from_org_id, to_org_id);
