-- 20260903000000_add_admin_tenant_role.sql
-- テナント管理画面(/admin_tenant)専用のロール 'admin_tenant' を追加する。
-- 既存の owner/admin は has_tenant_role() 経由の一般的なテナント権限階層を持つが、
-- admin_tenant は /admin_tenant アクセスのためだけの独立したロールとして扱う
-- (既存の owner/admin/viewer 階層には影響を与えない)。

alter table tenant_members
  drop constraint if exists tenant_members_role_check;

alter table tenant_members
  add constraint tenant_members_role_check
  check (role in ('owner', 'admin', 'viewer', 'developer', 'admin_tenant'));
