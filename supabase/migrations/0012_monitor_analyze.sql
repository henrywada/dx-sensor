-- 0012_monitor_analyze.sql
alter table auto_captures
  add column if not exists processed_at timestamptz;

create index if not exists auto_captures_unprocessed_idx
  on auto_captures (captured_by, created_at)
  where processed_at is null;

create table if not exists monitor_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  title text not null default '',
  email text,
  slot_values jsonb not null default '[]'::jsonb,
  template_id text,
  updated_at timestamptz not null default now()
);

alter table monitor_user_settings enable row level security;

create policy "monitor_user_settings_select_own"
  on monitor_user_settings for select using (user_id = auth.uid());
create policy "monitor_user_settings_insert_own"
  on monitor_user_settings for insert with check (user_id = auth.uid());
create policy "monitor_user_settings_update_own"
  on monitor_user_settings for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.monitor_user_settings to authenticated;

create table if not exists monitor_change_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  prev_capture_id uuid not null references auto_captures(id) on delete cascade,
  curr_capture_id uuid not null references auto_captures(id) on delete cascade,
  diff_score numeric not null,
  severity text not null check (severity in ('minor', 'notify')),
  ai_summary text,
  email_queued boolean not null default false,
  created_at timestamptz not null default now()
);

alter table monitor_change_events enable row level security;

create policy "monitor_change_events_select_own"
  on monitor_change_events for select using (user_id = auth.uid());
create policy "monitor_change_events_insert_own"
  on monitor_change_events for insert with check (user_id = auth.uid());

create index if not exists monitor_change_events_user_created_idx
  on monitor_change_events (user_id, created_at desc);

grant select, insert on public.monitor_change_events to authenticated;
