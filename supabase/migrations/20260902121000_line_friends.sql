-- 20260902121000_line_friends.sql
-- LINE連携: LINE友だち↔アカウントの紐付け状態

create table line_friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  line_user_id text not null unique,
  display_name text,
  status text not null default 'unlinked'
    check (status in ('unlinked', 'linked', 'blocked')),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists line_friends_tenant_idx
  on line_friends (tenant_id);
create index if not exists line_friends_user_idx
  on line_friends (user_id);

alter table line_friends enable row level security;

-- service_role のみが書き込む(webhook/invite-accept/liff-authの処理経由)ため、
-- tenant/userに向けたINSERT/UPDATEポリシーは設けない。SELECTのみテナントメンバーに許可する。
create policy line_friends_tenant_isolation on line_friends
  for select using (
    is_app_developer() or tenant_id in (select auth_tenant_ids())
  );

grant select on public.line_friends to authenticated;
