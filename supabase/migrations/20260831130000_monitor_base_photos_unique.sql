-- supabase/migrations/20260831130000_monitor_base_photos_unique.sql
--
-- 「基本写真はユーザーごとに常に最新の1件のみ」という運用上の前提を、
-- アプリ側の削除→挿入の実装だけでなくDB制約としても保証する
-- （final review指摘: ユニーク制約が無いと、この前提が崩れても検知できない）。

create unique index if not exists monitor_base_photos_tenant_user_uidx
  on monitor_base_photos (tenant_id, user_id);
