-- ============================================================================
-- 0003 — Stable enums (shared, slow-changing vocabularies)
-- Entity STATE MACHINES (order/booking/commission/... .status) are NOT enums —
-- they use CHECK constraints per table so they can evolve without ALTER TYPE.
-- ============================================================================

create type currency        as enum ('usd','dop','eur','mxn','cop','brl');
create type sales_channel    as enum ('direct','web','phone','whatsapp','walk_in','b2b_portal','agency','tour_center','ota','pos');
create type beneficiary_type as enum ('partner','supervisor','seller','company');
create type calc_type        as enum ('percentage','fixed','tiered','volume','net_rate','markup');
create type payment_method   as enum ('cash','card','transfer','link','credit','deposit','check','other');
create type payment_kind     as enum ('payment','refund','deposit','credit_note');
create type aging_bucket     as enum ('current','1_30','31_60','61_90','over_90');
