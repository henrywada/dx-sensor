import { createServiceSupabase } from "./server";

/**
 * Resolves a Vault secret reference (a UUID stored in a `*_secret_ref`
 * column, e.g. `cameras.soracam_secret_ref`) into the actual decrypted
 * credential.
 *
 * This is the single implementation used everywhere a `resolveSecret()`
 * TODO previously existed (poll-soracam route, ingest route, etc).
 * Only callable from server-side code, since it uses the service-role
 * client and the underlying `get_vault_secret()` Postgres function is
 * restricted to service_role (see supabase/migrations/0005_vault_secret_helper.sql).
 */
export async function resolveSecret(secretRef: string | null | undefined): Promise<string> {
  if (!secretRef) {
    throw new Error("resolveSecret() called with an empty secret_ref");
  }

  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("get_vault_secret", { secret_id: secretRef });

  if (error) {
    throw new Error(`Failed to resolve secret ${secretRef}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`No secret value returned for ref ${secretRef}`);
  }

  return data as string;
}
