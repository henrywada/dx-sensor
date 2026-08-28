-- 0019_captured_documents.sql
-- 汎用文書キャプチャ。v1 の種類は business_card（名刺）。
-- 明細行テーブルは作らない。後日 captured_document_line_items(document_id)
--   → captured_documents(id) ON DELETE CASCADE を追加する。

create table if not exists captured_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null,
  company_visible boolean not null default false,
  title text not null default '',
  counterparty text not null default '',
  context_date date,
  amount_yen numeric(12, 2),
  notes text not null default '',
  tags text[] not null default '{}',
  extracted jsonb not null default '{}'::jsonb,
  raw_ocr text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table captured_documents is
  '汎用文書キャプチャ。種類は document_type（コードのプラグインが正）。伝票明細は v1 では extracted.line_items。後日 captured_document_line_items を document_id FK で追加する。';

create index if not exists captured_documents_tenant_type_created_idx
  on captured_documents (tenant_id, document_type, created_at desc);
create index if not exists captured_documents_tenant_owner_idx
  on captured_documents (tenant_id, owner_user_id);
create index if not exists captured_documents_tenant_visible_idx
  on captured_documents (tenant_id, company_visible);
create index if not exists captured_documents_tenant_context_date_idx
  on captured_documents (tenant_id, context_date desc);

create table if not exists captured_document_images (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references captured_documents(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  sort_order int not null,
  role text not null check (role in ('front', 'back', 'page')),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists captured_document_images_document_idx
  on captured_document_images (document_id, sort_order);

alter table captured_documents enable row level security;
alter table captured_document_images enable row level security;

create policy captured_documents_insert on captured_documents
  for insert with check (
    owner_user_id = auth.uid()
    and tenant_id in (select auth_tenant_ids())
  );

create policy captured_documents_select on captured_documents
  for select using (
    is_app_developer()
    or (
      tenant_id in (select auth_tenant_ids())
      and (owner_user_id = auth.uid() or company_visible)
    )
  );

create policy captured_documents_update on captured_documents
  for update using (
    is_app_developer()
    or (
      tenant_id in (select auth_tenant_ids())
      and (
        owner_user_id = auth.uid()
        or (company_visible and has_tenant_role(tenant_id, 'admin'))
      )
    )
  ) with check (
    is_app_developer()
    or (
      tenant_id in (select auth_tenant_ids())
      and (
        owner_user_id = auth.uid()
        or has_tenant_role(tenant_id, 'admin')
      )
    )
  );

create policy captured_documents_delete on captured_documents
  for delete using (
    is_app_developer()
    or (
      tenant_id in (select auth_tenant_ids())
      and (
        owner_user_id = auth.uid()
        or (company_visible and has_tenant_role(tenant_id, 'admin'))
      )
    )
  );

create policy captured_document_images_select on captured_document_images
  for select using (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and (
        is_app_developer()
        or (
          d.tenant_id in (select auth_tenant_ids())
          and (d.owner_user_id = auth.uid() or d.company_visible)
        )
      )
    )
  );

create policy captured_document_images_insert on captured_document_images
  for insert with check (
    tenant_id in (select auth_tenant_ids())
    and exists (
      select 1 from captured_documents d
      where d.id = document_id
      and d.tenant_id = captured_document_images.tenant_id
      and (
        is_app_developer()
        or d.owner_user_id = auth.uid()
        or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
      )
    )
  );

create policy captured_document_images_update on captured_document_images
  for update using (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and (
        is_app_developer()
        or (
          d.tenant_id in (select auth_tenant_ids())
          and (
            d.owner_user_id = auth.uid()
            or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
          )
        )
      )
    )
  ) with check (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and d.tenant_id = captured_document_images.tenant_id
      and (
        is_app_developer()
        or (
          d.tenant_id in (select auth_tenant_ids())
          and (
            d.owner_user_id = auth.uid()
            or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
          )
        )
      )
    )
  );

create policy captured_document_images_delete on captured_document_images
  for delete using (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and (
        is_app_developer()
        or (
          d.tenant_id in (select auth_tenant_ids())
          and (
            d.owner_user_id = auth.uid()
            or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
          )
        )
      )
    )
  );

grant select, insert, update, delete on public.captured_documents to authenticated;
grant select, insert, update, delete on public.captured_document_images to authenticated;

alter table image_analysis_runs
  add column if not exists captured_document_id uuid
    references captured_documents(id) on delete set null;

drop policy if exists image_analysis_runs_update_own_captured_document
  on image_analysis_runs;
create policy image_analysis_runs_update_own_captured_document
  on image_analysis_runs for update
  using (
    user_id = auth.uid()
    and tenant_id in (select auth_tenant_ids())
  )
  with check (
    user_id = auth.uid()
    and tenant_id in (select auth_tenant_ids())
  );

grant update (captured_document_id) on public.image_analysis_runs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'captured-documents',
  'captured-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy captured_documents_storage_tmp
  on storage.objects for all
  using (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] = 'tmp'
    and (storage.foldername(name))[1]::uuid in (select auth_tenant_ids())
    and (storage.foldername(name))[3]::uuid = auth.uid()
  )
  with check (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] = 'tmp'
    and (storage.foldername(name))[1]::uuid in (select auth_tenant_ids())
    and (storage.foldername(name))[3]::uuid = auth.uid()
  );

create policy captured_documents_storage_final_insert
  on storage.objects for insert
  with check (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] is distinct from 'tmp'
    and (storage.foldername(name))[1]::uuid in (select auth_tenant_ids())
  );

create policy captured_documents_storage_final_select
  on storage.objects for select
  using (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] is distinct from 'tmp'
    and exists (
      select 1
      from captured_document_images i
      join captured_documents d on d.id = i.document_id
      where i.storage_path = name
        and (
          is_app_developer()
          or (
            d.tenant_id in (select auth_tenant_ids())
            and (d.owner_user_id = auth.uid() or d.company_visible)
          )
        )
    )
  );

create policy captured_documents_storage_final_delete
  on storage.objects for delete
  using (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] is distinct from 'tmp'
    and exists (
      select 1
      from captured_document_images i
      join captured_documents d on d.id = i.document_id
      where i.storage_path = name
        and (
          is_app_developer()
          or (
            d.tenant_id in (select auth_tenant_ids())
            and (
              d.owner_user_id = auth.uid()
              or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
            )
          )
        )
    )
  );
