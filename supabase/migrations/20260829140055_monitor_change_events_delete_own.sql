-- 0024_monitor_change_events_delete_own.sql
--
-- /capture_auto_analyze の起動時に、そのユーザー自身の古いイベント履歴を
-- クリアできるようにする。monitor_change_events にはこれまでselect/insert
-- のRLSポリシーしかなく、delete用のポリシー・権限が存在しなかった。
create policy "monitor_change_events_delete_own"
  on monitor_change_events for delete
  using (user_id = auth.uid());

grant delete on public.monitor_change_events to authenticated;
