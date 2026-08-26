-- 0015_drop_parking_lots_spots.sql
-- 未使用の駐車場固有テーブルを削除する。
-- vehicle_events.parking_spot_id は FK のため先に列を落とす。

drop index if exists idx_vehicle_events_tenant_spot_time;

alter table vehicle_events
  drop column if exists parking_spot_id;

create index if not exists idx_vehicle_events_tenant_camera_time
  on vehicle_events (tenant_id, camera_id, captured_at desc);

drop policy if exists parking_spots_all on parking_spots;
drop policy if exists parking_lots_all on parking_lots;

drop table if exists parking_spots;
drop table if exists parking_lots;
