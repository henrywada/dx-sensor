-- 0007_grant_authenticated_tenant_members.sql
--
-- 症状: getActiveTenant() が tenant_members に対して
--   code: 42501 / permission denied for table tenant_members
-- で失敗する。
--
-- 原因: RLSポリシー(is_app_developer() OR tenant_id IN (...))は正しく
--   定義されているが、その手前のテーブルレベルのGRANTが authenticated
--   ロールに付与されていなかった。PostgreSQLの権限チェックは
--   「テーブルへのGRANT」→「RLSによる行フィルタ」の2段階であり、
--   1段階目で拒否されるとRLSの中身に関わらず permission denied になる。
--
-- 0004_grant_service_role.sql は service_role 向けの GRANT であり、
-- 通常ログインユーザーが使う authenticated ロールへの付与は
-- 別途必要だったが、0001_init.sql の時点で漏れていたと見られる。
--
-- manual_captures のRLSポリシーも内部で tenant_members への
-- サブクエリを使っているため、この GRANT 漏れは連鎖的に
-- manual_captures への INSERT/SELECT も失敗させる可能性がある。
-- そのため tenant_members と manual_captures の両方に対して、
-- 既存のRLSポリシーが許可している操作範囲に対応する GRANT を
-- 明示的に付与する。

-- ============================================================
-- tenant_members
--   SELECT: tenant_members_select ポリシーに対応
--   INSERT/UPDATE/DELETE: tenant_members_write(ALL)ポリシーに対応
-- ============================================================

grant select on public.tenant_members to authenticated;
grant insert, update, delete on public.tenant_members to authenticated;

-- ============================================================
-- manual_captures
--   0006で定義したRLSポリシーに対応する範囲のGRANT
-- ============================================================

grant select, insert, delete on public.manual_captures to authenticated;

-- ============================================================
-- 確認用(適用後、Supabase SQL Editorで実行して権限を確認できる)
-- ============================================================
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('tenant_members', 'manual_captures')
--   and grantee = 'authenticated';
