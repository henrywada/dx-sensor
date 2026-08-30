-- supabase/migrations/20260830100000_monitor_sessions.sql
--
-- 「履歴ファイル」機能: 監視を保存付きで停止したときのイベント履歴・画像を
-- 過去分としてアーカイブし、後から選んで一覧・復元閲覧できるようにする。
-- 汎用化方針（CLAUDE.md）に沿い、駐車場固有の語彙を持ち込まず、
-- 既存の monitor_* 系テーブルの命名パターンを踏襲する。

create table if not exists monitor_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  stopped_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table monitor_sessions is
  '「イベント履歴・画像を保存して停止する」で確定した監視区間の記録（履歴ファイル一覧の単位）。';

alter table monitor_sessions enable row level security;

create policy "monitor_sessions_select_own"
  on monitor_sessions for select using (user_id = auth.uid());
create policy "monitor_sessions_insert_own"
  on monitor_sessions for insert with check (user_id = auth.uid());

create index if not exists monitor_sessions_user_started_idx
  on monitor_sessions (user_id, started_at desc);

grant select, insert on public.monitor_sessions to authenticated;

-- monitor_change_events をセッションに紐付けられるようにする。
-- session_id が null のままの行が「現在（未アーカイブ）」の履歴。
alter table monitor_change_events
  add column if not exists session_id uuid references monitor_sessions(id);

create index if not exists monitor_change_events_session_idx
  on monitor_change_events (session_id);

-- アーカイブ時に既存イベント行へ session_id を書き込むために update 権限が必要
-- （これまでは select/insert/delete のみで update ポリシーが無かった）。
create policy "monitor_change_events_update_own"
  on monitor_change_events for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant update on public.monitor_change_events to authenticated;
