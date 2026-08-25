-- 0008_picture_sends.sql
--
-- 「画像送信」機能: 件名・本文・撮影画像をユーザー単位で保存する。
-- 現時点ではテナント隔離は行わず、auth.uid() のみでアクセスを制限する。

-- ============================================================
-- 1. picture_send_subjects（繰り返し件名マスタ）
-- ============================================================

create table if not exists picture_send_subjects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, label)
);

comment on table picture_send_subjects is
  '画像送信で繰り返し使う件名マスタ。ユーザー単位で管理する。';

alter table picture_send_subjects enable row level security;

create policy "picture_send_subjects_select_own"
  on picture_send_subjects for select
  using (user_id = auth.uid());

create policy "picture_send_subjects_insert_own"
  on picture_send_subjects for insert
  with check (user_id = auth.uid());

create policy "picture_send_subjects_update_own"
  on picture_send_subjects for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "picture_send_subjects_delete_own"
  on picture_send_subjects for delete
  using (user_id = auth.uid());

create index if not exists picture_send_subjects_user_id_idx
  on picture_send_subjects (user_id, label);

-- ============================================================
-- 2. picture_sends（送信レコード）
-- ============================================================

create table if not exists picture_sends (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  user_email   text not null,
  subject_id   uuid references picture_send_subjects(id) on delete set null,
  subject_text text not null,
  body_text    text not null default '',
  storage_path text not null,
  created_at   timestamptz not null default now()
);

comment on table picture_sends is
  '画像送信の記録。件名・本文・画像をユーザー単位で保存する。';

alter table picture_sends enable row level security;

create policy "picture_sends_select_own"
  on picture_sends for select
  using (user_id = auth.uid());

create policy "picture_sends_insert_own"
  on picture_sends for insert
  with check (user_id = auth.uid());

create policy "picture_sends_delete_own"
  on picture_sends for delete
  using (user_id = auth.uid());

create index if not exists picture_sends_user_created_idx
  on picture_sends (user_id, created_at desc);

-- ============================================================
-- 3. authenticated ロールへの GRANT
-- ============================================================

grant select, insert, update, delete on public.picture_send_subjects to authenticated;
grant select, insert, delete on public.picture_sends to authenticated;

-- ============================================================
-- 4. Storage バケット + RLS
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'picture-sends',
  'picture-sends',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- パス規約 {user_id}/{yyyy-mm-dd}/{uuid}.jpg の先頭セグメント(user_id)で隔離
create policy "picture_sends_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'picture-sends'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

create policy "picture_sends_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'picture-sends'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );

create policy "picture_sends_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'picture-sends'
    and (storage.foldername(name))[1]::uuid = auth.uid()
  );
