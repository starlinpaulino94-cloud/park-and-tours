-- ============================================================================
-- 0014 — Park + maintenance: attraction, vehicle, asset, attraction_log,
-- waiver_template, waiver, incident, incident_action, inspection_template,
-- maintenance_plan, work_order, inspection, task.
-- Ends by wiring all remaining deferred FKs that pointed forward at this file.
-- ============================================================================

create table attraction (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  code        text,
  zone_id     uuid references zone(id) on delete set null,
  attraction_type text check (attraction_type in
                ('ride','water','show','animal','adventure','exhibit','play_area','service')),
  operational_status text not null default 'closed' check (operational_status in
                ('open','delayed','paused','closed','maintenance','weather_hold')),
  capacity_hour        integer check (capacity_hour        >= 0),
  capacity_simultaneous integer check (capacity_simultaneous >= 0),
  queue_minutes        integer check (queue_minutes        >= 0),
  guests_today         integer not null default 0 check (guests_today >= 0),
  duration_min         integer check (duration_min         >= 0),
  min_height_cm        integer check (min_height_cm        >= 0),
  max_height_cm        integer check (max_height_cm        >= 0),
  min_age              integer check (min_age              >= 0),
  max_weight_kg        integer check (max_weight_kg        >= 0),
  health_restrictions  text,
  requires_waiver      boolean not null default false,
  weather_sensitive    boolean not null default false,
  downtime_minutes_today integer not null default 0 check (downtime_minutes_today >= 0),
  last_status_at   timestamptz,
  cover_image_url  text,
  location    text,
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index attraction_org_idx  on attraction (organization_id, status);
create index attraction_zone_idx on attraction (organization_id, zone_id);
create trigger attraction_touch before update on attraction for each row execute function app.touch_updated_at();

create table vehicle (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  supplier_id uuid references supplier(id) on delete set null,
  driver_id   uuid references staff(id) on delete set null,
  name        text,
  plate       text,
  vehicle_type text check (vehicle_type in ('bus','minibus','van','suv_4x4','boat','catamaran','buggy','other')),
  capacity    integer check (capacity >= 0),
  photo_url   text,
  insurance_expiry  date,
  inspection_expiry date,
  status      text not null default 'available' check (status in
                ('available','in_service','maintenance','out_of_service')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index vehicle_org_idx      on vehicle (organization_id, status);
create index vehicle_supplier_idx on vehicle (organization_id, supplier_id);
create trigger vehicle_touch before update on vehicle for each row execute function app.touch_updated_at();

create table asset (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  code        text,
  asset_type  text check (asset_type in ('ride','vehicle','boat','buggy','equipment','facility','it','pool')),
  operational_status text not null default 'in_service' check (operational_status in
                ('in_service','maintenance','out_of_service','retired')),
  blocks_capacity boolean not null default false,
  criticality text check (criticality in ('critical','high','medium','low')),
  serial_number text,
  location    text,
  capacity    integer check (capacity >= 0),
  purchase_date date,
  purchase_cost numeric(14,2) check (purchase_cost >= 0),
  currency    currency,
  warranty_until date,
  meter_hours numeric(14,2),
  meter_km    numeric(14,2),
  next_maintenance_at timestamptz,
  downtime_minutes_month integer not null default 0 check (downtime_minutes_month >= 0),
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  zone_id     uuid references zone(id) on delete set null,
  vehicle_id  uuid references vehicle(id) on delete set null,
  supplier_id uuid references supplier(id) on delete set null,
  branch_id   uuid references branch(id) on delete set null,
  attraction_id uuid references attraction(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index asset_org_idx        on asset (organization_id, status);
create index asset_attraction_idx on asset (attraction_id);
create trigger asset_touch before update on asset for each row execute function app.touch_updated_at();

create table attraction_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  attraction_id uuid not null references attraction(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  staff_id    uuid references staff(id) on delete set null,
  event_type  text check (event_type in
                ('status_change','capacity_change','incident','weather','cleaning','headcount','note')),
  from_status text check (from_status in ('open','delayed','paused','closed','maintenance','weather_hold')),
  to_status   text check (to_status   in ('open','delayed','paused','closed','maintenance','weather_hold')),
  duration_min integer check (duration_min >= 0),
  guests      integer check (guests >= 0),
  reason      text,
  logged_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index attraction_log_org_idx        on attraction_log (organization_id, logged_at desc);
create index attraction_log_attraction_idx on attraction_log (attraction_id);
create trigger attraction_log_touch before update on attraction_log for each row execute function app.touch_updated_at();

create table waiver_template (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  version     text,
  jurisdiction text,
  language    text check (language in ('es','en','fr','de','it','pt','ru')),
  body        text,
  requires_guardian boolean not null default false,
  min_age_self_sign integer check (min_age_self_sign >= 0),
  valid_from  date,
  valid_to    date,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, name, version)
);
create index waiver_template_org_idx on waiver_template (organization_id, status);
create trigger waiver_template_touch before update on waiver_template for each row execute function app.touch_updated_at();

create table waiver (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  signature_name text,
  waiver_template_id uuid references waiver_template(id) on delete set null,
  participant_id uuid references participant(id) on delete set null,
  customer_id uuid references customer(id) on delete set null,
  booking_id  uuid references booking(id) on delete set null,
  product_id  uuid references product(id) on delete set null,
  signed_at   timestamptz,
  valid_until date,
  signature_data text,
  document_id text,
  document_type text check (document_type in ('passport','id_card','driver_license','minor_id')),
  template_version text,
  body_snapshot text,
  guardian_name text,
  guardian_document text,
  status      text not null default 'pending' check (status in ('signed','pending','expired','revoked')),
  ip_address  text,
  channel     text check (channel in ('kiosk','online','counter','mobile')),
  health_flags text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index waiver_org_idx         on waiver (organization_id, status);
create index waiver_participant_idx on waiver (participant_id);
create index waiver_booking_idx     on waiver (booking_id);
create trigger waiver_touch before update on waiver for each row execute function app.touch_updated_at();

create table incident (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  occurred_at timestamptz,
  reported_at timestamptz,
  closed_at   timestamptz,
  severity    text check (severity in ('minor','moderate','major','critical','fatality')),
  incident_type text check (incident_type in
                ('injury','illness','near_miss','property_damage','lost_child','security',
                 'environmental','ride_stoppage','food_safety','other')),
  status      text not null default 'open' check (status in
                ('open','investigating','action_required','resolved','closed','escalated')),
  title       text,
  description text,
  location    text,
  immediate_action text,
  root_cause  text,
  witnesses   text,
  medical_attention  boolean not null default false,
  evacuation         boolean not null default false,
  authority_notified boolean not null default false,
  insurance_claim    boolean not null default false,
  estimated_cost numeric(14,2) check (estimated_cost >= 0),
  currency    currency,
  photos      text[] default '{}',
  attraction_id uuid references attraction(id) on delete set null,
  asset_id    uuid references asset(id) on delete set null,
  zone_id     uuid references zone(id) on delete set null,
  participant_id uuid references participant(id) on delete set null,
  booking_id  uuid references booking(id) on delete set null,
  customer_id uuid references customer(id) on delete set null,
  vehicle_id  uuid references vehicle(id) on delete set null,
  departure_id uuid references departure(id) on delete set null,
  reported_by uuid references auth.users(id) on delete set null,
  assigned_to_id uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index incident_org_idx        on incident (organization_id, status);
create index incident_attraction_idx on incident (attraction_id);
create trigger incident_touch before update on incident for each row execute function app.touch_updated_at();

create table incident_action (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  action      text,
  description text,
  due_date    date,
  completed_at timestamptz,
  status      text not null default 'pending' check (status in
                ('pending','in_progress','done','cancelled','verified')),
  priority    text check (priority in ('low','medium','high','urgent')),
  verification_notes text,
  incident_id uuid not null references incident(id) on delete cascade,
  assigned_to_id uuid references auth.users(id) on delete set null,
  verified_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index incident_action_incident_idx on incident_action (incident_id);
create trigger incident_action_touch before update on incident_action for each row execute function app.touch_updated_at();

create table inspection_template (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  code        text,
  frequency   text check (frequency in
                ('pre_opening','daily','weekly','monthly','quarterly','annual','on_demand')),
  category    text check (category in
                ('safety','mechanical','electrical','hygiene','water_quality','food_safety','vehicle','fire','general')),
  checklist   text,
  pass_threshold numeric(6,2),
  requires_signature boolean not null default false,
  blocks_operation_on_fail boolean not null default false,
  estimated_min integer check (estimated_min >= 0),
  status      text not null default 'active' check (status in ('active','inactive')),
  asset_id    uuid references asset(id) on delete set null,
  attraction_id uuid references attraction(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index inspection_template_org_idx on inspection_template (organization_id, status);
create trigger inspection_template_touch before update on inspection_template for each row execute function app.touch_updated_at();

create table maintenance_plan (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  trigger_type text check (trigger_type in ('calendar','meter_hours','meter_km','usage_count','condition')),
  interval_days  integer check (interval_days  >= 0),
  interval_hours integer check (interval_hours >= 0),
  interval_km    integer check (interval_km    >= 0),
  lead_time_days integer check (lead_time_days >= 0),
  task_list   text,
  estimated_min  integer check (estimated_min >= 0),
  estimated_cost numeric(14,2) check (estimated_cost >= 0),
  last_executed_at timestamptz,
  next_due_at timestamptz,
  takes_asset_down boolean not null default false,
  status      text not null default 'active' check (status in ('active','inactive')),
  asset_id    uuid references asset(id) on delete set null,
  attraction_id uuid references attraction(id) on delete set null,
  vehicle_id  uuid references vehicle(id) on delete set null,
  inspection_template_id uuid references inspection_template(id) on delete set null,
  staff_id    uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index maintenance_plan_org_idx   on maintenance_plan (organization_id, status);
create index maintenance_plan_asset_idx on maintenance_plan (asset_id);
create trigger maintenance_plan_touch before update on maintenance_plan for each row execute function app.touch_updated_at();

create table work_order (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  title       text,
  order_type  text check (order_type in
                ('corrective','preventive','predictive','improvement','inspection_followup','emergency')),
  priority    text check (priority in ('low','medium','high','urgent')),
  status      text not null default 'draft' check (status in
                ('draft','open','assigned','in_progress','waiting_parts','waiting_approval','done','verified','cancelled')),
  opened_at   timestamptz,
  scheduled_at timestamptz,
  started_at  timestamptz,
  finished_at timestamptz,
  description text,
  work_performed text,
  downtime_min integer check (downtime_min >= 0),
  labor_hours numeric(6,2) check (labor_hours >= 0),
  labor_cost  numeric(14,2) check (labor_cost >= 0),
  parts_cost  numeric(14,2) check (parts_cost >= 0),
  total_cost  numeric(14,2) check (total_cost >= 0),
  currency    currency,
  takes_asset_down boolean not null default false,
  meter_reading numeric(14,2),
  asset_id    uuid references asset(id) on delete set null,
  attraction_id uuid references attraction(id) on delete set null,
  vehicle_id  uuid references vehicle(id) on delete set null,
  assigned_to_id uuid references auth.users(id) on delete set null,
  supplier_id uuid references supplier(id) on delete set null,
  incident_id uuid references incident(id) on delete set null,
  maintenance_plan_id uuid references maintenance_plan(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index work_order_org_idx   on work_order (organization_id, status);
create index work_order_asset_idx on work_order (asset_id);
create trigger work_order_touch before update on work_order for each row execute function app.touch_updated_at();

create table inspection (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  signature_name text,
  performed_at timestamptz,
  result      text check (result in ('pass','pass_with_observations','fail','not_applicable')),
  score       numeric(6,2),
  items_total  integer check (items_total  >= 0),
  items_failed integer check (items_failed >= 0),
  findings    text,
  blocked_operation boolean not null default false,
  photos      text[] default '{}',
  next_due_at timestamptz,
  inspection_template_id uuid references inspection_template(id) on delete set null,
  asset_id    uuid references asset(id) on delete set null,
  attraction_id uuid references attraction(id) on delete set null,
  vehicle_id  uuid references vehicle(id) on delete set null,
  performed_by uuid references auth.users(id) on delete set null,
  work_order_id uuid references work_order(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index inspection_org_idx      on inspection (organization_id, performed_at desc);
create index inspection_template_idx on inspection (inspection_template_id);
create trigger inspection_touch before update on inspection for each row execute function app.touch_updated_at();

create table task (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  title       text not null,
  description text,
  status      text not null default 'todo' check (status in
                ('todo','in_progress','blocked','waiting','done','cancelled')),
  priority    text check (priority in ('low','medium','high','urgent')),
  due_at      timestamptz,
  completed_at timestamptz,
  task_type   text check (task_type in
                ('general','follow_up','operational','maintenance','safety','finance','sales','onboarding')),
  source      text check (source in ('manual','automatic','escalation','checklist')),
  checklist   text,
  assigned_to_id uuid references auth.users(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  booking_id  uuid references booking(id) on delete set null,
  order_id    uuid references sales_order(id) on delete set null,
  incident_id uuid references incident(id) on delete set null,
  work_order_id uuid references work_order(id) on delete set null,
  guest_case_id uuid references guest_case(id) on delete set null,
  customer_id uuid references customer(id) on delete set null,
  lead_id     uuid references lead(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index task_org_idx      on task (organization_id, status);
create index task_assigned_idx on task (assigned_to_id, status);
create trigger task_touch before update on task for each row execute function app.touch_updated_at();

-- deferred FKs that pointed forward at this file
alter table shift
  add constraint shift_attraction_fk foreign key (attraction_id) references attraction(id) on delete set null;
create index shift_attraction_idx on shift (attraction_id);

alter table departure_resource
  add constraint departure_resource_vehicle_fk foreign key (vehicle_id) references vehicle(id) on delete set null;
create index departure_resource_vehicle_idx on departure_resource (vehicle_id);

alter table pickup_route
  add constraint pickup_route_vehicle_fk foreign key (vehicle_id) references vehicle(id) on delete set null;
create index pickup_route_vehicle_idx on pickup_route (vehicle_id);

alter table guest_case
  add constraint guest_case_incident_fk foreign key (incident_id) references incident(id) on delete set null;
create index guest_case_incident_idx on guest_case (incident_id);

alter table stock_movement
  add constraint stock_movement_work_order_fk foreign key (work_order_id) references work_order(id) on delete set null;
create index stock_movement_work_order_idx on stock_movement (work_order_id);
