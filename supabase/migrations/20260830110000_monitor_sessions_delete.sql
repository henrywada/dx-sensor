-- 20260830110000_monitor_sessions_delete.sql
--
-- 「履歴ファイルを削除する手段」を追加する。
-- monitor_sessions にはこれまでselect/insertのRLSポリシーしかなく、
-- delete用のポリシー・権限が存在しなかった。
--
-- monitor_change_events.session_id の外部キーは元々ON DELETE指定なし
-- （NO ACTION）だったため、参照するイベント行が残ったままセッションを
-- 削除しようとするとFK違反で失敗していた。履歴ファイルの削除は
-- 「そのセッションに属するログ（イベント）ごと削除する」ことを意味するため、
-- ON DELETE CASCADEに変更し、セッション削除で紐づくイベント行も
-- まとめて削除されるようにする。

alter table monitor_change_events
  drop constraint if exists monitor_change_events_session_id_fkey,
  add constraint monitor_change_events_session_id_fkey
    foreign key (session_id) references monitor_sessions(id) on delete cascade;

create policy "monitor_sessions_delete_own"
  on monitor_sessions for delete using (user_id = auth.uid());

grant delete on public.monitor_sessions to authenticated;
