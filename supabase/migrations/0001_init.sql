-- dx-sensor: initial schema
-- Conventions carried over from dx-toolbox:
--   - tenant isolation via RLS, never hardcoded developer emails
--   - role stored as a column (tenant_members.role) checked by helper functions
--   - is_premium flag on tenants for future monetization gating
--   - routing convention: /apps/parking/[tenant_slug] on the frontend (not enforced in DB)

-- ============================================================
-- 1. Core tenant tables (mirrors dx-toolbox's tenant model)
-- ============================================================

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  is_premium boolean not null default false,
  created_at timestamptz not null default now()
);

-- membership + role. role values: 'owner' | 'admin' | 'viewer' | 'developer'
-- 'developer' = cross-tenant access (Henry's own account), NOT hardcoded by email.
create table if not exists tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'viewer', 'developer')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- ============================================================
-- 2. Helper functions (SECURITY DEFINER, used inside RLS policies)
-- ============================================================

create or replace function auth_tenant_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select tenant_id from tenant_members where user_id = auth.uid();
$$;

create or replace function is_app_developer()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from tenant_members
    where user_id = auth.uid() and role = 'developer'
  );
$$;

create or replace function has_tenant_role(target_tenant_id uuid, min_role text)
returns boolean
language sql
security definer
stable
as $$
  -- min_role check order: viewer < admin < owner
  select exists (
    select 1 from tenant_members
    where user_id = auth.uid()
      and tenant_id = target_tenant_id
      and (
        role = 'owner'
        or (role = 'admin' and min_role in ('admin', 'viewer'))
        or (role = 'viewer' and min_role = 'viewer')
      )
  );
$$;

-- ============================================================
-- 3. Domain tables
-- ============================================================

create table if not exists cameras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  vendor text not null check (vendor in ('tapo', 'reolink', 'other')),
  host text not null,
  port int not null default 2020,
  username text not null,
  -- store only a reference to a secret (e.g. Vercel/Supabase Vault key name),
  -- never the raw password in plaintext in this table
  secret_ref text not null,
  onvif_profile_token text,
  ftp_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists parking_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists parking_spots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  parking_lot_id uuid not null references parking_lots(id) on delete cascade,
  camera_id uuid references cameras(id) on delete set null,
  label text not null,               -- e.g. "A-1"
  bbox jsonb,                        -- pixel coords of the spot within the camera frame
  created_at timestamptz not null default now()
);

create table if not exists vehicle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  parking_spot_id uuid not null references parking_spots(id) on delete cascade,
  camera_id uuid references cameras(id) on delete set null,
  captured_at timestamptz not null default now(),
  image_path text,                   -- Supabase Storage path
  occupied boolean not null,
  plate_number text,
  plate_confidence numeric,
  vehicle_color text,
  vehicle_make_model text,
  raw_anpr_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_events_tenant_spot_time
  on vehicle_events (tenant_id, parking_spot_id, captured_at desc);

-- ============================================================
-- 4. RLS
-- ============================================================

alter table tenants enable row level security;
alter table tenant_members enable row level security;
alter table cameras enable row level security;
alter table parking_lots enable row level security;
alter table parking_spots enable row level security;
alter table vehicle_events enable row level security;

-- tenants: members can see their own tenant, developer sees all
create policy tenants_select on tenants
  for select using (
    is_app_developer() or id in (select auth_tenant_ids())
  );

create policy tenants_update on tenants
  for update using (
    is_app_developer() or has_tenant_role(id, 'admin')
  );

-- tenant_members: visible to members of the same tenant + developer
create policy tenant_members_select on tenant_members
  for select using (
    is_app_developer() or tenant_id in (select auth_tenant_ids())
  );

create policy tenant_members_write on tenant_members
  for all using (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  );

-- generic tenant-scoped policy, repeated per table
create policy cameras_all on cameras
  for all using (
    is_app_developer() or tenant_id in (select auth_tenant_ids())
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  );

create policy parking_lots_all on parking_lots
  for all using (
    is_app_developer() or tenant_id in (select auth_tenant_ids())
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  );

create policy parking_spots_all on parking_spots
  for all using (
    is_app_developer() or tenant_id in (select auth_tenant_ids())
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  );

create policy vehicle_events_select on vehicle_events
  for select using (
    is_app_developer() or tenant_id in (select auth_tenant_ids())
  );

-- vehicle_events are written by the server (service role / cron job) only,
-- not directly by tenant users, since they come from the ANPR pipeline.
create policy vehicle_events_service_write on vehicle_events
  for insert with check (auth.role() = 'service_role');
