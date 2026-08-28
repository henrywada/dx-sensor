-- 0020_captured_document_line_items.sql
-- 伝票明細行。v1 では invoice のみ使用。

create table if not exists captured_document_line_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references captured_documents(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  line_no int not null check (line_no > 0),
  transaction_date date,
  description text not null default '',
  quantity text not null default '',
  unit text not null default '',
  unit_price numeric(12, 2),
  amount numeric(12, 2),
  tax_rate text not null default '',
  created_at timestamptz not null default now(),
  unique (document_id, line_no)
);

create index if not exists captured_document_line_items_document_idx
  on captured_document_line_items (document_id, line_no);
create index if not exists captured_document_line_items_tenant_document_idx
  on captured_document_line_items (tenant_id, document_id);

alter table captured_document_line_items enable row level security;

create policy captured_document_line_items_select on captured_document_line_items
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

create policy captured_document_line_items_insert on captured_document_line_items
  for insert with check (
    tenant_id in (select auth_tenant_ids())
    and exists (
      select 1 from captured_documents d
      where d.id = document_id
      and d.tenant_id = captured_document_line_items.tenant_id
      and (
        is_app_developer()
        or d.owner_user_id = auth.uid()
        or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
      )
    )
  );

create policy captured_document_line_items_update on captured_document_line_items
  for update using (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and (
        is_app_developer()
        or d.owner_user_id = auth.uid()
        or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
      )
    )
  );

create policy captured_document_line_items_delete on captured_document_line_items
  for delete using (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and (
        is_app_developer()
        or d.owner_user_id = auth.uid()
        or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
      )
    )
  );

grant select, insert, update, delete on captured_document_line_items to authenticated;
