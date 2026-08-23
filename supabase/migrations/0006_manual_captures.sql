-- 0006_manual_captures.sql
--
-- 「ログインしてスマホから1枚アップロードできる」最小実装。
-- soracam / balenaCloud に次ぐ第3の取得経路(手動撮影)のためのテーブル・RLS・Storageバケット。
--
-- 設計メモ:
-- - cameras テーブル(host/port/vendor 等、物理カメラ前提の列)には無理に統合せず、
--   別テーブルとして独立させる。将来 observation_targets 等への汎用化リファクタ時に
--   統合しやすいよう、あえてシンプルな構造に留めている。
-- - service_role への GRANT は 0004_grant_service_role.sql の
--   `alter default privileges` により自動的に付与される想定。
--   適用後は `supabase migration list` で Local/Remote 差分を必ず確認すること(教訓9)。

-- ============================================================
-- 1. manual_captures テーブル
-- ============================================================

create table if not exists manual_captures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  captured_by uuid not null references auth.users(id),
  storage_path text not null,       -- Storage内のパス: {tenant_id}/{yyyy-mm-dd}/{uuid}.jpg
  note text,                        -- 任意メモ(撮影場所名など。将来 observation point 概念に発展させる余地)
  created_at timestamptz not null default now()
);

comment on table manual_captures is
  '手動撮影(スマホ等)によるアップロード画像の記録。soracam/balenaCloudに次ぐ第3の取得経路。';

alter table manual_captures enable row level security;

-- テナント間の完全隔離(既存の tenant_members ベースのパターンを踏襲)
create policy "manual_captures_tenant_isolation_select"
  on manual_captures for select
  using (
    tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "manual_captures_tenant_isolation_insert"
  on manual_captures for insert
  with check (
    tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

-- 削除は当面想定しないが、誤アップロードの取り消し用に本人限定で許可
create policy "manual_captures_delete_own"
  on manual_captures for delete
  using (
    captured_by = auth.uid()
    and tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create index if not exists manual_captures_tenant_id_idx
  on manual_captures (tenant_id, created_at desc);

-- ============================================================
-- 2. Storage バケット + RLS
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'manual-captures',
  'manual-captures',
  false,
  10485760, -- 10MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- パス規約 {tenant_id}/{yyyy-mm-dd}/{uuid}.jpg の先頭セグメント(tenant_id)で隔離
create policy "manual_captures_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'manual-captures'
    and (storage.foldername(name))[1]::uuid in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "manual_captures_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'manual-captures'
    and (storage.foldername(name))[1]::uuid in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "manual_captures_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'manual-captures'
    and (storage.foldername(name))[1]::uuid in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );
