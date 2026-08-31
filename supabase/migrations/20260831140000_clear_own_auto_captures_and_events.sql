-- 20260831120000_clear_own_auto_captures_and_events.sql
--
-- /capture_auto 起動時に「前のイベント履歴」と「画像」をまとめてクリーンにする。
--
-- 従来はauto_captures（画像）のクリアだけをクライアント側で行っており、
-- monitor_change_events（イベント履歴）はクリアされていなかった
-- （MonitorAnalyzeView.tsxのclearOwnMonitorEventsコメントに「/capture_autoと
-- 同様」と書かれていたが、実装が漏れていた）。
--
-- 「履歴ファイル」（session_idが付いたアーカイブ済みの保存済み履歴）は
-- 引き続き保護し、消してはいけない。session_id is null の「現在の」
-- イベント履歴だけを対象にする。
--
-- 画像側も、アーカイブ済み履歴ファイルが参照しているauto_captures行は
-- 消してはいけない（monitor_change_events.*_capture_idはon delete set nullの
-- ため、消すとログは残るのに比較画像だけ失われる。過去の
-- monitor_captures_retain_minor_eventsで直したのと同じ問題を再発させる）。
--
-- イベント削除→画像削除の順に単一関数内で行うことで、「session_id is null
-- だったイベントが参照していた処理済み画像」もこのタイミングで安全に
-- 間引ける（イベントを先に消しているので、もう履歴表示から参照されない）。
--
-- security invoker（デフォルト）のため、呼び出し元ロール(authenticated)の
-- RLS（monitor_change_events_delete_own / auto_captures_delete_own）が
-- そのまま適用される。p_tenant_id / p_user_id を偽装されても、削除できる
-- 範囲はRLSでauth.uid()に紐づく行に限定される。

create or replace function clear_own_auto_captures_and_events(
  p_tenant_id uuid,
  p_user_id uuid
)
returns table(storage_path text)
language plpgsql
set search_path = public
as $$
begin
  delete from monitor_change_events
  where user_id = p_user_id
    and session_id is null;

  return query
  delete from auto_captures
  where tenant_id = p_tenant_id
    and captured_by = p_user_id
    and not exists (
      select 1 from monitor_change_events e
      where e.session_id is not null
        and (e.prev_capture_id = auto_captures.id or e.curr_capture_id = auto_captures.id)
    )
  returning auto_captures.storage_path;
end;
$$;

revoke all on function clear_own_auto_captures_and_events(uuid, uuid) from public, anon;
grant execute on function clear_own_auto_captures_and_events(uuid, uuid) to authenticated;
