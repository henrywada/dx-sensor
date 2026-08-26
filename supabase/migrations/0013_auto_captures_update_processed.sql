create policy "auto_captures_update_own"
  on auto_captures for update
  using (
    captured_by = auth.uid()
    and tenant_id in (select tenant_id from tenant_members where user_id = auth.uid())
  )
  with check (
    captured_by = auth.uid()
    and tenant_id in (select tenant_id from tenant_members where user_id = auth.uid())
  );

grant update on public.auto_captures to authenticated;
