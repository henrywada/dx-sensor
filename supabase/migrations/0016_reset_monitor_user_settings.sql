-- 0016_reset_monitor_user_settings.sql
-- システムテンプレート刷新に伴い、既存のユーザー監視条件をクリアする。
-- （テンプレート本体はアプリの SYSTEM_MONITOR_TEMPLATES。本テーブルはユーザー保存値のみ）

delete from monitor_user_settings;
