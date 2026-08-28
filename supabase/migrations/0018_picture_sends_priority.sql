-- 0018_picture_sends_priority.sql
--
-- 画像送信に優先度（高・中・低）を追加する。
-- 既存行は中（medium）とする。

alter table picture_sends
  add column if not exists priority text not null default 'medium';

alter table picture_sends
  drop constraint if exists picture_sends_priority_check;

alter table picture_sends
  add constraint picture_sends_priority_check
  check (priority in ('high', 'medium', 'low'));

comment on column picture_sends.priority is
  '送信時の優先度。high=高 / medium=中 / low=低。';
