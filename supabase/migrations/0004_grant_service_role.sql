-- dx-sensor: explicitly grant service_role access to the public schema.
--
-- Root cause: this project's service_role Postgres role did not have the
-- usual automatic grants on public schema tables, causing
-- "permission denied for table X" errors even when using a valid
-- service_role/secret key (this is a Postgres GRANT-level issue,
-- separate from and prior to RLS policy evaluation — service_role
-- bypasses RLS via BYPASSRLS, but still needs baseline table grants).
--
-- This is idempotent and safe to run multiple times.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- Ensure any tables created by future migrations also get this automatically.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
