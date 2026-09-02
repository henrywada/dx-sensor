-- 20260902120000_tenant_member_invites.sql
-- LINE連携: テナントメンバー招待（メールアドレス指定→招待URL発行）

create table tenant_member_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invitee_email text not null,
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'viewer')),
  invite_token text not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tenant_member_invites_tenant_idx
  on tenant_member_invites (tenant_id, created_at desc);
create index if not exists tenant_member_invites_token_idx
  on tenant_member_invites (invite_token);

alter table tenant_member_invites enable row level security;

create policy tenant_member_invites_admin_only on tenant_member_invites
  for all using (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  );

grant select, insert, update, delete on public.tenant_member_invites to authenticated;
