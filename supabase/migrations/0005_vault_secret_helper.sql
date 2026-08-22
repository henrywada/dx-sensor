-- dx-sensor: Supabase Vault integration for resolving camera/API secrets.
--
-- `cameras.secret_ref` and `cameras.soracam_secret_ref` store a Vault secret
-- UUID, never the raw credential. This function is the only way those
-- secrets are ever read back — it's SECURITY DEFINER so it can access the
-- `vault.decrypted_secrets` view (which is normally locked down), but it's
-- REVOKEd from all roles except service_role, so it can only be called
-- from trusted backend code (Cron routes, ingest API), never from a
-- browser session using the publishable key.

create or replace function get_vault_secret(secret_id uuid)
returns text
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  secret_value text;
begin
  select decrypted_secret into secret_value
  from vault.decrypted_secrets
  where id = secret_id;

  if secret_value is null then
    raise exception 'No vault secret found for id %', secret_id;
  end if;

  return secret_value;
end;
$$;

revoke all on function get_vault_secret(uuid) from public;
revoke all on function get_vault_secret(uuid) from anon;
revoke all on function get_vault_secret(uuid) from authenticated;
grant execute on function get_vault_secret(uuid) to service_role;

-- ============================================================
-- Write-side wrappers, used by scripts/store-vault-secret.ts.
-- vault.create_secret / vault.update_secret live in the `vault` schema,
-- which PostgREST (and therefore supabase-js's .rpc()) can't call
-- directly — these public-schema wrappers expose them, restricted to
-- service_role only (never callable with the publishable/anon key).
-- ============================================================

create or replace function vault_create_secret(
  secret_value text,
  secret_name text,
  secret_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  new_id uuid;
begin
  new_id := vault.create_secret(secret_value, secret_name, secret_description);
  return new_id;
end;
$$;

create or replace function vault_update_secret(secret_id uuid, new_secret text)
returns void
language plpgsql
security definer
set search_path = vault, public
as $$
begin
  perform vault.update_secret(secret_id, new_secret);
end;
$$;

create or replace function vault_find_secret_by_name(secret_name text)
returns uuid
language sql
security definer
set search_path = vault, public
as $$
  select id from vault.secrets where name = secret_name limit 1;
$$;

revoke all on function vault_create_secret(text, text, text) from public, anon, authenticated;
revoke all on function vault_update_secret(uuid, text) from public, anon, authenticated;
revoke all on function vault_find_secret_by_name(text) from public, anon, authenticated;
grant execute on function vault_create_secret(text, text, text) to service_role;
grant execute on function vault_update_secret(uuid, text) to service_role;
grant execute on function vault_find_secret_by_name(text) to service_role;
