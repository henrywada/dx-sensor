-- 20260904010000_auto_captures_cleanup_thumbnail_path.sql
--
-- thumbnail_path追加(20260904000000)に伴い、画像削除系のDB関数
-- (delete_capture_if_unreferenced, clear_own_auto_captures_and_events)も
-- thumbnail_pathを返すように更新する。
--
-- これを怠ると、フルサイズ画像はStorageから削除されるが対応するサムネイルは
-- 削除されずに残り続け（どのDB行からも参照されない孤立オブジェクトとして
-- 蓄積する）、Storage容量を無制限に消費してしまう
-- （egressクォータ対策として導入した仕組みが、今度はストレージ容量の
-- リークを生む本末転倒な状態になる）。
--
-- 戻り値の型（列構成）を変更するため、create or replaceではなくdrop→createで
-- 定義し直す。

drop function if exists delete_capture_if_unreferenced(uuid);

create function delete_capture_if_unreferenced(p_capture_id uuid)
returns table(storage_path text, thumbnail_path text)
language plpgsql
set search_path = public
as $$
begin
  return query
  delete from auto_captures
  where id = p_capture_id
    and not exists (
      select 1 from monitor_change_events
      where severity in ('minor', 'notify')
        and (prev_capture_id = p_capture_id or curr_capture_id = p_capture_id)
    )
  returning auto_captures.storage_path, auto_captures.thumbnail_path;
end;
$$;

revoke all on function delete_capture_if_unreferenced(uuid) from public, anon;
grant execute on function delete_capture_if_unreferenced(uuid) to authenticated;

drop function if exists clear_own_auto_captures_and_events(uuid, uuid);

create function clear_own_auto_captures_and_events(
  p_tenant_id uuid,
  p_user_id uuid
)
returns table(storage_path text, thumbnail_path text)
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
  returning auto_captures.storage_path, auto_captures.thumbnail_path;
end;
$$;

revoke all on function clear_own_auto_captures_and_events(uuid, uuid) from public, anon;
grant execute on function clear_own_auto_captures_and_events(uuid, uuid) to authenticated;
