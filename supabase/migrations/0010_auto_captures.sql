-- 0010_auto_captures.sql
--
-- 「スマホ定点監視」(/capture_auto) 用の取得経路。
-- 手動撮影 (manual_captures / manual-captures) とは分離する。
-- 既存 manual_captures のデータ移行は行わない（新規分のみ）。

-- ============================================================
-- 1. auto_captures テーブル
-- ============================================================

create table if not exists auto_captures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  captured_by uuid not null references auth.users(id),
  storage_path text not null,       -- Storage内のパス: {tenant_id}/{yyyy-mm-dd}/{uuid}.jpg
  note text,
  created_at timestamptz not null default now()
);

comment on table auto_captures is
  'スマホ定点監視(/capture_auto)による自動撮影画像の記録。手動撮影(manual_captures)とは別経路。';

alter table auto_captures enable row level security;

create policy "auto_captures_tenant_isolation_select"
  on auto_captures for select
  using (
    tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "auto_captures_tenant_isolation_insert"
  on auto_captures for insert
  with check (
    tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "auto_captures_delete_own"
  on auto_captures for delete
  using (
    captured_by = auth.uid()
    and tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create index if not exists auto_captures_tenant_id_idx
  on auto_captures (tenant_id, created_at desc);

grant select, insert, delete on public.auto_captures to authenticated;

-- ============================================================
-- 2. Storage バケット + RLS
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'auto-captures',
  'auto-captures',
  false,
  10485760, -- 10MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "auto_captures_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'auto-captures'
    and (storage.foldername(name))[1]::uuid in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "auto_captures_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'auto-captures'
    and (storage.foldername(name))[1]::uuid in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "auto_captures_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'auto-captures'
    and (storage.foldername(name))[1]::uuid in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );
