-- 0023_delete_capture_if_unreferenced_search_path.sql
--
-- 0022で追加したdelete_capture_if_unreferenced()は、search_pathを固定して
-- いなかったため、Supabaseのsecurity linterで
-- "function_search_path_mutable" 警告が出た。DELETE操作を行う関数なので
-- search_pathを明示的に固定する。
alter function delete_capture_if_unreferenced(uuid) set search_path = public;
