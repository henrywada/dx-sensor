-- 0026_monitor_captures_retain_minor_events.sql
--
-- 0022では「severity='notify'で参照されていなければ削除可」としていたが、
-- runMonitorTick側の変更により'minor'（軽微な変化）判定もGemini解析まで
-- 進んだ判定として、前回画像を即座に削除しなくなった。DB側の
-- delete_capture_if_unreferenced()もそれに合わせて保護対象を広げないと、
-- 'minor'イベントが参照するauto_captures行が別のtickの削除処理
-- （例えば直後のskip判定tickがそのcaptureを新たなprevCaptureとして削除する
-- ケース）で消え、イベント履歴の比較表示（今回写真↔前回写真）が
-- 「比較画像が見つかりません」になってしまう。
--
-- severity='skip'（変化なし）は引き続き削除対象のまま
-- （skipはGemini解析を行わないため、比較表示の対象にしない）。

drop index if exists monitor_change_events_prev_notify_idx;
drop index if exists monitor_change_events_curr_notify_idx;

create index if not exists monitor_change_events_prev_kept_idx
  on monitor_change_events (prev_capture_id) where severity in ('minor', 'notify');
create index if not exists monitor_change_events_curr_kept_idx
  on monitor_change_events (curr_capture_id) where severity in ('minor', 'notify');

create or replace function delete_capture_if_unreferenced(p_capture_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_storage_path text;
begin
  delete from auto_captures
  where id = p_capture_id
    and not exists (
      select 1 from monitor_change_events
      where severity in ('minor', 'notify')
        and (prev_capture_id = p_capture_id or curr_capture_id = p_capture_id)
    )
  returning storage_path into v_storage_path;

  return v_storage_path;
end;
$$;

revoke all on function delete_capture_if_unreferenced(uuid) from public, anon;
grant execute on function delete_capture_if_unreferenced(uuid) to authenticated;
