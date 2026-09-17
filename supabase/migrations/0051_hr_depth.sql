-- ═══════════════════════════════════════════════════════════════════════════
-- 0051 — RR. HH.: QUE LO QUE SE TECLEA SIRVA PARA ALGO
--
-- POR QUÉ
--
-- El módulo de personal lleva desde 0009 pidiendo tres datos que NADIE lee:
--
--  · `certification.blocks_assignment` — una casilla que dice «esto bloquea la
--    asignación» y que jamás bloqueó nada. El guía con el curso de primeros
--    auxilios vencido sale igual con cuarenta pasajeros, y el día que pasa algo
--    la empresa descubre que su propio sistema lo sabía.
--
--  · `certification.status` — tecleado a mano. Se escribe «vigente» el día que
--    se registra y ahí se queda para siempre: la fecha de vencimiento pasa y
--    la insignia sigue verde.
--
--  · `attendance.hours_worked` — tecleado a mano teniendo la entrada y la
--    salida al lado. Es decir: el sistema tiene los dos marcajes y le pide a
--    una persona que haga la resta.
--
-- QUÉ AÑADE ESTA MIGRACIÓN
--
-- Lo que falta para cerrar el ciclo turno → asistencia → horas → nómina, y
-- nada más. Los cálculos NO viven aquí: viven en `src/lib/hr.ts`, que es puro
-- y se prueba. La base guarda el resultado y, sobre todo, guarda QUIÉN lo
-- aprobó y EN QUÉ corrida se pagó — que es lo que impide pagar dos veces.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── el expediente laboral de la persona ────────────────────────────────────
--
-- `staff` nació pensado para el guía freelance que cobra por día. La misma
-- tabla sostiene ahora al empleado fijo, y para pagarle hacen falta datos que
-- no existían: cómo se le paga, cuánto, y su número de la Seguridad Social.
alter table staff
  add column if not exists payroll_code text,
  -- Cómo se remunera. De aquí sale la base de la nómina: por hora marcada,
  -- por día trabajado o un sueldo mensual que no depende de las horas.
  add column if not exists salary_type text,
  add column if not exists base_salary numeric(14,2),
  add column if not exists hourly_rate numeric(14,2),
  -- El NSS del empleado. Sin él la nómina no se puede subir a la TSS.
  add column if not exists social_security_id text,
  add column if not exists bank_account text,
  add column if not exists bank_name text,
  -- El personal externo (el guía que factura, el proveedor) NO cotiza: se le
  -- paga contra factura. Distinguirlo evita descontarle TSS a quien no toca.
  add column if not exists applies_social_security boolean not null default false,
  add column if not exists termination_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_salary_type_check') then
    alter table staff add constraint staff_salary_type_check
      check (salary_type is null or salary_type in ('hourly','daily','monthly','per_service'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_base_salary_check') then
    alter table staff add constraint staff_base_salary_check
      check (base_salary is null or base_salary >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_hourly_rate_check') then
    alter table staff add constraint staff_hourly_rate_check
      check (hourly_rate is null or hourly_rate >= 0);
  end if;
end $$;

-- ── la certificación deja de ser decorativa ────────────────────────────────
alter table certification
  -- El barrido diario avisa una vez, no todos los días. Sin esta marca, el
  -- responsable recibe el mismo aviso treinta veces y deja de leerlos.
  add column if not exists reminder_sent_at timestamptz,
  -- Cuándo se comprobó por última vez contra el calendario. Sirve para saber
  -- si una insignia verde es verde porque está vigente o porque el barrido
  -- lleva días sin correr.
  add column if not exists checked_at timestamptz;

create index if not exists certification_expiry_idx
  on certification (organization_id, expires_at)
  where expires_at is not null;

-- ── el turno se publica ────────────────────────────────────────────────────
--
-- Un cuadrante en borrador y un cuadrante publicado no son lo mismo: el
-- segundo es un compromiso con la persona, que ya organizó su semana. Sin esta
-- marca, «publicado» era solo una palabra en el desplegable de estado.
alter table shift
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users(id) on delete set null;

create index if not exists shift_staff_date_idx on shift (organization_id, staff_id, shift_date);

-- ── la asistencia: horas calculadas, aprobadas y pagadas una sola vez ──────
alter table attendance
  -- El descanso se descuenta de las horas. Estaba en `shift` y no en el
  -- marcaje, así que la resta real nunca podía hacerse aquí.
  add column if not exists break_min integer,
  add column if not exists regular_hours numeric(6,2),
  add column if not exists approved_at timestamptz,
  -- La corrida de nómina que YA PAGÓ este marcaje. Es la misma defensa que en
  -- las liquidaciones de proveedor: un marcaje reclamado no lo puede reclamar
  -- otra corrida, y sin eso dos generaciones a la vez pagan el mismo día dos
  -- veces.
  add column if not exists payroll_run_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_break_min_check') then
    alter table attendance add constraint attendance_break_min_check
      check (break_min is null or break_min >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_regular_hours_check') then
    alter table attendance add constraint attendance_regular_hours_check
      check (regular_hours is null or regular_hours >= 0);
  end if;
end $$;

-- Un marcaje por persona y día. Dos filas para el mismo día son horas contadas
-- dos veces en la nómina, y ese es justo el error que nadie detecta a tiempo.
--
-- Si una empresa YA tiene duplicados de cuando la pantalla los dejaba crear, la
-- migración no se cae ni le borra marcajes a nadie: deja el índice sin unicidad
-- y avisa. Quien tenga que decidir cuál de los dos marcajes vale es la persona
-- que estuvo allí, no esta migración.
do $$
begin
  begin
    create unique index if not exists attendance_staff_day_idx
      on attendance (organization_id, staff_id, attendance_date)
      where staff_id is not null and attendance_date is not null;
  exception when unique_violation then
    raise warning 'attendance: hay marcajes duplicados (misma persona y día). Se deja el índice sin unicidad; revísalos y vuelve a aplicar esta migración.';
    create index if not exists attendance_staff_day_idx
      on attendance (organization_id, staff_id, attendance_date);
  end;
end $$;

-- ── la corrida de nómina ───────────────────────────────────────────────────
create table if not exists payroll_run (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code            text,
  period_start    date not null,
  period_end      date not null,
  -- Quincenal es lo normal en la República Dominicana; mensual y semanal
  -- existen y el sistema no tiene por qué imponer uno.
  period_type     text not null default 'biweekly'
                    check (period_type in ('weekly','biweekly','monthly','custom')),
  status          text not null default 'draft'
                    check (status in ('draft','approved','paid','cancelled')),
  currency        currency not null default 'dop',

  -- Los porcentajes se COPIAN a la corrida al generarla, no se leen del
  -- maestro al imprimirla. Si la TSS cambia el año que viene, lo pagado en
  -- marzo tiene que seguir explicándose con los números de marzo.
  sfs_employee_pct numeric(6,3) not null default 3.041,
  afp_employee_pct numeric(6,3) not null default 2.870,
  sfs_employer_pct numeric(6,3) not null default 7.090,
  afp_employer_pct numeric(6,3) not null default 7.100,
  risk_employer_pct numeric(6,3) not null default 1.200,

  gross_amount    numeric(14,2) not null default 0,
  deductions_amount numeric(14,2) not null default 0,
  net_amount      numeric(14,2) not null default 0,
  employer_cost   numeric(14,2) not null default 0,
  staff_count     integer not null default 0,

  approved_by     uuid references auth.users(id) on delete set null,
  approved_at     timestamptz,
  paid_at         timestamptz,
  branch_id       uuid references branch(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint payroll_run_period_check check (period_end >= period_start)
);

create index if not exists payroll_run_org_idx on payroll_run (organization_id, status, period_start desc);
create unique index if not exists payroll_run_code_idx
  on payroll_run (organization_id, code) where code is not null;

-- Dos corridas del mismo periodo son la nómina pagada dos veces. Se permite
-- volver a generarla si la anterior se anuló.
create unique index if not exists payroll_run_period_idx
  on payroll_run (organization_id, period_start, period_end)
  where status <> 'cancelled';

create table if not exists payroll_line (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  payroll_run_id  uuid not null references payroll_run(id) on delete cascade,
  staff_id        uuid references staff(id) on delete set null,

  -- El nombre y el código se copian: si la persona se da de baja o se corrige
  -- su ficha, la nómina de marzo tiene que seguir diciendo a quién se pagó.
  staff_name      text,
  payroll_code    text,
  social_security_id text,

  days_worked     numeric(6,2) not null default 0,
  regular_hours   numeric(8,2) not null default 0,
  overtime_hours  numeric(8,2) not null default 0,
  -- Las que pasan de 68 h/semana: el Código de Trabajo las paga al 100 %, no
  -- al 35 %. Separarlas es la única forma de que el recargo salga bien.
  extra_overtime_hours numeric(8,2) not null default 0,
  hourly_rate     numeric(14,2) not null default 0,

  regular_amount  numeric(14,2) not null default 0,
  overtime_amount numeric(14,2) not null default 0,
  other_earnings  numeric(14,2) not null default 0,
  gross_amount    numeric(14,2) not null default 0,

  sfs_employee    numeric(14,2) not null default 0,
  afp_employee    numeric(14,2) not null default 0,
  isr_amount      numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  deductions_amount numeric(14,2) not null default 0,
  net_amount      numeric(14,2) not null default 0,
  employer_cost   numeric(14,2) not null default 0,

  currency        text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists payroll_line_run_idx   on payroll_line (payroll_run_id);
create index if not exists payroll_line_staff_idx on payroll_line (organization_id, staff_id);

-- Una persona, una línea por corrida.
create unique index if not exists payroll_line_run_staff_idx
  on payroll_line (payroll_run_id, staff_id) where staff_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_payroll_run_fk') then
    alter table attendance add constraint attendance_payroll_run_fk
      foreign key (payroll_run_id) references payroll_run(id) on delete set null;
  end if;
end $$;

create index if not exists attendance_payroll_idx
  on attendance (organization_id, payroll_run_id) where payroll_run_id is not null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'payroll_run_touch') then
    create trigger payroll_run_touch before update on payroll_run
      for each row execute function app.touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payroll_line_touch') then
    create trigger payroll_line_touch before update on payroll_line
      for each row execute function app.touch_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'payroll_run' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.payroll_run');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'payroll_line' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.payroll_line');
  end if;
end $$;

drop trigger if exists payroll_run_same_tenant_refs on payroll_run;
create trigger payroll_run_same_tenant_refs
before insert or update of organization_id, branch_id on payroll_run
for each row execute function app.enforce_same_tenant_refs('branch_id', 'branch');

drop trigger if exists payroll_line_same_tenant_refs on payroll_line;
create trigger payroll_line_same_tenant_refs
before insert or update of organization_id, payroll_run_id, staff_id on payroll_line
for each row execute function app.enforce_same_tenant_refs(
  'payroll_run_id', 'payroll_run',
  'staff_id', 'staff'
);
