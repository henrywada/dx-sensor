-- 20260903010000_admin_tenant_friend_invite_access.sql
-- admin_tenant ロールでも LINE友だち招待画面(招待発行/メンバー招待)を使えるようにする。
-- has_tenant_role() は owner/admin/viewer の一般階層専用のまま変更せず、
-- 対象の2ポリシーにのみ admin_tenant を明示的に許可する
-- (他のadmin向けRLS対象テーブル(tenants/cameras等)へは影響させないため)。

drop policy if exists tenant_member_invites_admin_only on tenant_member_invites;
create policy tenant_member_invites_admin_only on tenant_member_invites
  for all using (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
    or exists (
      select 1 from tenant_members
      where tenant_id = tenant_member_invites.tenant_id
        and user_id = auth.uid()
        and role = 'admin_tenant'
    )
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
    or exists (
      select 1 from tenant_members
      where tenant_id = tenant_member_invites.tenant_id
        and user_id = auth.uid()
        and role = 'admin_tenant'
    )
  );

drop policy if exists line_friend_invites_admin_only on line_friend_invites;
create policy line_friend_invites_admin_only on line_friend_invites
  for all using (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
    or exists (
      select 1 from tenant_members
      where tenant_id = line_friend_invites.tenant_id
        and user_id = auth.uid()
        and role = 'admin_tenant'
    )
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
    or exists (
      select 1 from tenant_members
      where tenant_id = line_friend_invites.tenant_id
        and user_id = auth.uid()
        and role = 'admin_tenant'
    )
  );
