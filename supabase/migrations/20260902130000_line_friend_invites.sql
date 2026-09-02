-- 20260902130000_line_friend_invites.sql
-- LINE友だち招待: 既存アカウント保有者向けの「友だち追加のみ」の招待トークン

create table line_friend_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invite_token text not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references tenant_members (tenant_id, user_id) on delete cascade
);

create index if not exists line_friend_invites_tenant_idx
  on line_friend_invites (tenant_id, created_at desc);
create index if not exists line_friend_invites_token_idx
  on line_friend_invites (invite_token);

alter table line_friend_invites enable row level security;

create policy line_friend_invites_admin_only on line_friend_invites
  for all using (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  );

grant select, insert, update, delete on public.line_friend_invites to authenticated;
