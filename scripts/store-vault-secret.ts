/**
 * Stores a raw secret value into Supabase Vault and prints the UUID
 * to put into a `*_secret_ref` column (e.g. `cameras.soracam_secret_ref`).
 *
 * Usage (run locally, never on a device or in a committed file):
 *   npx tsx scripts/store-vault-secret.ts \
 *     --value "<the actual SORACOM authKeySecret or camera password>" \
 *     --name "soracam-device-<device_id>" \
 *     --description "SORACOM auth key secret for tenant X's parking camera"
 *
 * The --name must be unique per secret. Re-running with the same --name
 * rotates the existing secret in place — the UUID (and therefore the
 * `*_secret_ref` already stored in `cameras`) stays the same, so rotation
 * never requires updating the `cameras` row.
 */
import { createClient } from "@supabase/supabase-js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const value = arg("value");
  const name = arg("name");
  const description = arg("description") ?? "";

  if (!value || !name) {
    console.error('Usage: --value "<secret>" --name "<unique-name>" [--description "..."]');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: existingId, error: findError } = await supabase.rpc("vault_find_secret_by_name", {
    secret_name: name,
  });

  if (findError) {
    console.error("Failed to check for an existing secret:", findError.message);
    process.exit(1);
  }

  if (existingId) {
    const { error } = await supabase.rpc("vault_update_secret", {
      secret_id: existingId,
      new_secret: value,
    });
    if (error) {
      console.error("Failed to rotate secret:", error.message);
      process.exit(1);
    }
    console.log(`Rotated existing secret "${name}". Ref (unchanged): ${existingId}`);
    return;
  }

  const { data: newId, error: createError } = await supabase.rpc("vault_create_secret", {
    secret_value: value,
    secret_name: name,
    secret_description: description,
  });

  if (createError) {
    console.error("Failed to create secret:", createError.message);
    process.exit(1);
  }

  console.log(`Secret stored. Put this UUID into the relevant *_secret_ref column:\n`);
  console.log(newId);
}

main();
