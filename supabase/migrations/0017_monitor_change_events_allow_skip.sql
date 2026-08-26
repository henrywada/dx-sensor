-- 0017_monitor_change_events_allow_skip.sql
-- 「処理は動いたがイベントなし」ログ用に severity='skip' を許可する。

alter table monitor_change_events
  drop constraint if exists monitor_change_events_severity_check;

alter table monitor_change_events
  add constraint monitor_change_events_severity_check
  check (severity in ('skip', 'minor', 'notify'));
