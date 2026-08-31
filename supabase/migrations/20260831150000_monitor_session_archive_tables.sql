-- 20260831150000_monitor_session_archive_tables.sql
--
-- 「アクティブ履歴」と「履歴フォルダー」を、同一テーブルのタグ付け（session_id列）
-- ではなく物理的に別テーブルへ分離する。分離の狙いは、アクティブ側のクリーンアップ
-- （/capture_auto起動時のclear_own_auto_captures_and_events等）を「履歴フォルダー側から
-- 参照されていないか」の保護チェック無しに、常に無条件で実行できるようにするため
-- （保護チェックはアクティブ/履歴が同じテーブルを共有している限り必要になり、
-- 過去に往復のバグ（履歴フォルダーの画像が消える／逆に画像が全く消えない）を
-- 引き起こした）。
--
-- 画像はStorage実ファイルごと複製する。storage_pathを共有したままだと、アクティブ側の
-- 削除時に履歴フォルダー側からの参照チェックが結局必要になってしまうため。
--
-- 移行時の安全のため、既存の monitor_change_events.session_id 列・関連インデックス・
-- ポリシー、および clear_own_auto_captures_and_events の保護条件は、このマイグレーションでは
-- まだ残す（UI側がアーカイブ/復元をこの新テーブル経由に切り替え終わるまで、旧方式の
-- タグ付けロジックも動作し続ける必要があるため）。切り替え完了後の別マイグレーションで撤去する。

create table if not exists monitor_session_captures (
  -- 元の auto_captures.id をそのまま引き継ぐ（archive_current_session参照）。
  -- こうすることで、monitor_session_events.prev/curr_capture_id の複製時に
  -- IDの付け替えが不要になる。
  id uuid primary key,
  session_id uuid not null references monitor_sessions(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  captured_by uuid not null references auth.users(id),
  storage_path text not null,
  created_at timestamptz not null
);

comment on table monitor_session_captures is
  '履歴フォルダー（monitor_sessions）に保存された画像の複製。Storage実ファイルも複製先パスを持つ。';

alter table monitor_session_captures enable row level security;

create policy "monitor_session_captures_select_own"
  on monitor_session_captures for select using (captured_by = auth.uid());
create policy "monitor_session_captures_insert_own"
  on monitor_session_captures for insert with check (captured_by = auth.uid());
create policy "monitor_session_captures_delete_own"
  on monitor_session_captures for delete using (captured_by = auth.uid());

create index if not exists monitor_session_captures_session_idx
  on monitor_session_captures (session_id);

grant select, insert, delete on public.monitor_session_captures to authenticated;

create table if not exists monitor_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references monitor_sessions(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  prev_capture_id uuid references monitor_session_captures(id) on delete set null,
  curr_capture_id uuid references monitor_session_captures(id) on delete set null,
  diff_score numeric not null,
  severity text not null check (severity in ('skip', 'minor', 'notify')),
  ai_summary text,
  email_queued boolean not null default false,
  analysis_tool text,
  created_at timestamptz not null
);

comment on table monitor_session_events is
  '履歴フォルダー（monitor_sessions）に保存されたイベントログの複製。';

alter table monitor_session_events enable row level security;

create policy "monitor_session_events_select_own"
  on monitor_session_events for select using (user_id = auth.uid());
create policy "monitor_session_events_insert_own"
  on monitor_session_events for insert with check (user_id = auth.uid());

create index if not exists monitor_session_events_session_idx
  on monitor_session_events (session_id);

grant select, insert on public.monitor_session_events to authenticated;

-- ============================================================
-- アーカイブ用RPC: 「アクティブ履歴・画像を履歴フォルダーに保存して終了する」
-- ============================================================
--
-- クライアントは先に session_id を発番し（新storage_pathに session_id を含めた
-- 決定的なパスを組み立てるため、Storageコピーより前にIDが要る）、Storage `.copy()`
-- で対象画像を新パスへ複製しておいてから、その対応表
-- （p_capture_path_map: [{old_capture_id, new_storage_path}]）を渡す。
-- 新パスが指定されない画像（マップに無いid）は元のstorage_pathをそのまま使う
-- （通常は起きないが、クライアント側の取りこぼしに対する保険）。
--
-- security invoker（デフォルト）。呼び出し元ロール(authenticated)のRLSが
-- そのまま効くため、他人のデータを操作することはできない。
create or replace function archive_current_session(
  p_session_id uuid,
  p_tenant_id uuid,
  p_user_id uuid,
  p_started_at timestamptz,
  p_stopped_at timestamptz,
  p_capture_path_map jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into monitor_sessions (id, tenant_id, user_id, started_at, stopped_at)
  values (p_session_id, p_tenant_id, p_user_id, p_started_at, p_stopped_at);

  insert into monitor_session_captures (id, session_id, tenant_id, captured_by, storage_path, created_at)
  select
    ac.id,
    p_session_id,
    ac.tenant_id,
    ac.captured_by,
    coalesce(m.new_storage_path, ac.storage_path),
    ac.created_at
  from auto_captures ac
  left join jsonb_to_recordset(p_capture_path_map) as m(old_capture_id uuid, new_storage_path text)
    on m.old_capture_id = ac.id
  where ac.tenant_id = p_tenant_id
    and ac.captured_by = p_user_id;

  insert into monitor_session_events (
    session_id, tenant_id, user_id, prev_capture_id, curr_capture_id,
    diff_score, severity, ai_summary, email_queued, analysis_tool, created_at
  )
  select
    p_session_id, e.tenant_id, e.user_id, e.prev_capture_id, e.curr_capture_id,
    e.diff_score, e.severity, e.ai_summary, e.email_queued, e.analysis_tool, e.created_at
  from monitor_change_events e
  where e.user_id = p_user_id
    and e.session_id is null;

  delete from monitor_change_events where user_id = p_user_id and session_id is null;
  delete from auto_captures where tenant_id = p_tenant_id and captured_by = p_user_id;
end;
$$;

revoke all on function archive_current_session(uuid, uuid, uuid, timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function archive_current_session(uuid, uuid, uuid, timestamptz, timestamptz, jsonb) to authenticated;

-- ============================================================
-- 復元用RPC: 「履歴フォルダーを見る」でアクティブへ複製する
-- ============================================================
--
-- クライアントは先に monitor_session_captures の対象画像をStorage `.copy()` で
-- 新パスへ複製し、新IDも発番（gen_random_uuid()相当）した上で対応表
-- （p_capture_map: [{old_capture_id, new_capture_id, new_storage_path}]）を渡す。
-- 新IDを毎回発番するのは、同じ履歴フォルダーを繰り返し復元してもauto_capturesの
-- 主キー衝突が起きないようにするため（アーカイブ側はIDを維持するのと非対称）。
create or replace function restore_session_to_current(
  p_session_id uuid,
  p_tenant_id uuid,
  p_user_id uuid,
  p_capture_map jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into auto_captures (id, tenant_id, captured_by, storage_path, processed_at, created_at)
  select
    (m.new_capture_id)::uuid,
    p_tenant_id,
    p_user_id,
    m.new_storage_path,
    now(),
    sc.created_at
  from jsonb_to_recordset(p_capture_map) as m(old_capture_id uuid, new_capture_id uuid, new_storage_path text)
  join monitor_session_captures sc
    on sc.id = m.old_capture_id and sc.session_id = p_session_id;

  insert into monitor_change_events (
    user_id, tenant_id, prev_capture_id, curr_capture_id,
    diff_score, severity, ai_summary, email_queued, analysis_tool, created_at
  )
  select
    p_user_id, p_tenant_id,
    map_prev.new_capture_id, map_curr.new_capture_id,
    e.diff_score, e.severity, e.ai_summary, e.email_queued, e.analysis_tool, e.created_at
  from monitor_session_events e
  join jsonb_to_recordset(p_capture_map) as map_prev(old_capture_id uuid, new_capture_id uuid, new_storage_path text)
    on map_prev.old_capture_id = e.prev_capture_id
  join jsonb_to_recordset(p_capture_map) as map_curr(old_capture_id uuid, new_capture_id uuid, new_storage_path text)
    on map_curr.old_capture_id = e.curr_capture_id
  where e.session_id = p_session_id;
end;
$$;

revoke all on function restore_session_to_current(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function restore_session_to_current(uuid, uuid, uuid, jsonb) to authenticated;
