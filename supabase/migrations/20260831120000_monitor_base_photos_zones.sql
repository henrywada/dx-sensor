-- supabase/migrations/20260831120000_monitor_base_photos_zones.sql
--
-- 「監視ゾーン（フォーカスゾーン）」機能: 基本写真を1枚登録し、その上に
-- 変化検知の対象とする矩形領域（監視ゾーン、複数可）を指定できるようにする。
-- ゾーン座標は基本写真に対する正規化比率(0..1)で保存する（絶対ピクセルに
-- 依存すると、カメラ解像度が変わった場合に対応できないため）。

-- ============================================================
-- 1. monitor_base_photos: 基本写真（ユーザーごとに常に最新の1枚のみ）
-- ============================================================

create table if not exists monitor_base_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,       -- auto-captures バケット内: {tenant_id}/base/{uuid}.jpg
  created_at timestamptz not null default now()
);

comment on table monitor_base_photos is
  '監視ゾーンを指定するための基準となる基本写真。新規登録時にアプリ側が旧データを削除するため、ユーザーごとに常に最新の1件のみが残る想定。';

alter table monitor_base_photos enable row level security;

create policy "monitor_base_photos_select_own"
  on monitor_base_photos for select using (user_id = auth.uid());

create policy "monitor_base_photos_insert_own"
  on monitor_base_photos for insert
  with check (
    user_id = auth.uid()
    and tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "monitor_base_photos_delete_own"
  on monitor_base_photos for delete using (user_id = auth.uid());

create index if not exists monitor_base_photos_user_idx
  on monitor_base_photos (user_id, created_at desc);

grant select, insert, delete on public.monitor_base_photos to authenticated;

-- ============================================================
-- 2. monitor_zones: 基本写真上に指定した監視ゾーン（複数可）
-- ============================================================

create table if not exists monitor_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  base_photo_id uuid not null references monitor_base_photos(id) on delete cascade,
  zone_x numeric not null,       -- 左端 (0..1、基本写真の幅に対する比率)
  zone_y numeric not null,       -- 上端 (0..1、基本写真の高さに対する比率)
  zone_width numeric not null,   -- 幅   (0..1)
  zone_height numeric not null,  -- 高さ (0..1)
  created_at timestamptz not null default now()
);

comment on table monitor_zones is
  '基本写真(monitor_base_photos)上に指定した監視ゾーン。base_photo_idの基本写真が削除されると、on delete cascadeで同時に削除される（「前に登録した設定は消えます」を実現する）。';

alter table monitor_zones enable row level security;

create policy "monitor_zones_select_own"
  on monitor_zones for select using (user_id = auth.uid());

create policy "monitor_zones_insert_own"
  on monitor_zones for insert
  with check (
    user_id = auth.uid()
    and tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "monitor_zones_delete_own"
  on monitor_zones for delete using (user_id = auth.uid());

create index if not exists monitor_zones_base_photo_idx
  on monitor_zones (base_photo_id);

grant select, insert, delete on public.monitor_zones to authenticated;
