-- 20260903020000_tenants_tenant_type.sql
-- テナント種別（Free/Premium/会社テナント）を明示的に区別するカラムを追加する。
-- 既存のis_premium(boolean)はFree/Premiumの区別しかできず「会社テナント」を表現できないため、
-- 3値を持つtenant_typeを新設する。is_premium列は当面残す（撤去は別タスク）。

alter table tenants
  add column tenant_type text not null default 'free'
  check (tenant_type in ('free', 'premium', 'company'));

update tenants set tenant_type = 'premium' where is_premium = true;
