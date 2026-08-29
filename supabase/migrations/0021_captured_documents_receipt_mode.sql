-- 0021_captured_documents_receipt_mode.sql
-- receipt のような「区分（モード）」を持つ document_type のためのカラム。
-- モードを持たない種類（business_card/invoice/purchase_order）は常に null。

alter table captured_documents
  add column if not exists document_mode text;

comment on column captured_documents.document_mode is
  '区分（モード）。例: receipt の "expense"（社内経費）/ "qualified_invoice"（インボイス制度対応）。モードを持たない document_type は null。';

create index if not exists captured_documents_tenant_type_mode_idx
  on captured_documents (tenant_id, document_type, document_mode, created_at desc);
