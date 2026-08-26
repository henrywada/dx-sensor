-- 0011_picture_sends_update.sql
--
-- アルバム画面での本文編集（body_text UPDATE）を許可する。
-- SELECT/INSERT/DELETE は 0008 で付与済み。UPDATE ポリシーと GRANT が欠けていた。

create policy "picture_sends_update_own"
  on picture_sends for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant update on public.picture_sends to authenticated;
