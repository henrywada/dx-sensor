-- 0022_monitor_captures_cleanup.sql
--
-- skip/minor判定で不要になったauto_captures画像を安全に間引くための土台。
--
-- 1. monitor_change_events.prev_capture_id / curr_capture_id を
--    on delete cascade → on delete set null に変更する。
--
--    理由: skip/minor判定のtickは、その場でmonitor_change_eventsに
--    「処理はしたがイベントなし」ログ（0017参照）をinsertした直後に、
--    そのイベントが参照しているprevCaptureの画像を間引き対象として
--    削除する。cascadeのままだと、たった今insertしたイベント自身が
--    参照するauto_captures行を消すことになり、on delete cascadeで
--    イベントログそのものが同一tick内で即座に消えてしまう
--    （0017で意図した「処理ログ」機能が実質的に無効化される）。
--    set nullなら、画像だけが消えてイベントログ（severity / diff_score /
--    ai_summary / created_at）は残り、比較画像だけ表示できなくなる。
alter table monitor_change_events
  alter column prev_capture_id drop not null,
  alter column curr_capture_id drop not null;

alter table monitor_change_events
  drop constraint monitor_change_events_prev_capture_id_fkey,
  add constraint monitor_change_events_prev_capture_id_fkey
    foreign key (prev_capture_id) references auto_captures(id) on delete set null;

alter table monitor_change_events
  drop constraint monitor_change_events_curr_capture_id_fkey,
  add constraint monitor_change_events_curr_capture_id_fkey
    foreign key (curr_capture_id) references auto_captures(id) on delete set null;

-- 2. severity='notify'の参照有無チェック（下記関数内のNOT EXISTS）を
--    高速化する部分インデックス。notify行は少数派になる想定。
create index if not exists monitor_change_events_prev_notify_idx
  on monitor_change_events (prev_capture_id) where severity = 'notify';
create index if not exists monitor_change_events_curr_notify_idx
  on monitor_change_events (curr_capture_id) where severity = 'notify';

-- 3. 「notify証拠として参照されていなければ削除する」チェックと削除本体を
--    単一SQL文にまとめ、アプリ側の2回のDBラウンドトリップに分けない。
--    2回に分けると、チェックと削除の間に別セッションが同じcaptureを
--    参照するnotifyイベントを挿入するレースが起こり得る
--    （このRPCでもそのレースを完全には閉じないが、ウィンドウを
--    ネットワーク往復単位からステートメント単位まで縮小する）。
--
--    security definerにはしない。呼び出し元のロール（authenticated）で
--    実行され、auto_captures_delete_own のRLSポリシーがそのまま効く。
create or replace function delete_capture_if_unreferenced(p_capture_id uuid)
returns text
language plpgsql
as $$
declare
  v_storage_path text;
begin
  delete from auto_captures
  where id = p_capture_id
    and not exists (
      select 1 from monitor_change_events
      where severity = 'notify'
        and (prev_capture_id = p_capture_id or curr_capture_id = p_capture_id)
    )
  returning storage_path into v_storage_path;

  return v_storage_path;
end;
$$;

revoke all on function delete_capture_if_unreferenced(uuid) from public, anon;
grant execute on function delete_capture_if_unreferenced(uuid) to authenticated;
