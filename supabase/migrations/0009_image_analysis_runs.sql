-- 0009_image_analysis_runs.sql
--
-- 画像解析 API（Gemini / Claude / GPT / Plate Recognizer 等）の実行ログ。
-- 管理ダッシュボードの日別コスト概算バーチャートの元データ。
-- 解析レスポンス時点の概算円を保存する（公式請求書との一致は保証しない）。

create table if not exists image_analysis_runs (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  user_id              uuid not null references auth.users(id),
  capture_id           uuid references manual_captures(id) on delete set null,
  provider             text not null,
  estimated_cost_yen   numeric(12, 6),
  input_tokens         integer,
  output_tokens        integer,
  created_at           timestamptz not null default now()
);

comment on table image_analysis_runs is
  '画像解析 API の実行ログ。ダッシュボードのコスト概算集計用。';

alter table image_analysis_runs enable row level security;

create policy "image_analysis_runs_tenant_select"
  on image_analysis_runs for select
  using (
    tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "image_analysis_runs_tenant_insert"
  on image_analysis_runs for insert
  with check (
    user_id = auth.uid()
    and tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create index if not exists image_analysis_runs_created_at_idx
  on image_analysis_runs (created_at desc);

create index if not exists image_analysis_runs_tenant_created_idx
  on image_analysis_runs (tenant_id, created_at desc);

grant select, insert on public.image_analysis_runs to authenticated;
