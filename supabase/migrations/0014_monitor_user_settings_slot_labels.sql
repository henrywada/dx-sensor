-- 0014_monitor_user_settings_slot_labels.sql
-- カスタム監視条件用にスロット項目名（ラベル）をユーザ保存できるようにする。

alter table monitor_user_settings
  add column if not exists slot_labels jsonb not null default '[]'::jsonb;

comment on column monitor_user_settings.slot_labels is
  '監視条件の項目名×10。システムテンプレ以外のカスタム設定用。';
