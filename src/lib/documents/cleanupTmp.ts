import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET } from "./storagePaths";

export const TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type TmpFileEntry = {
  name: string;
  created_at?: string | null;
};

export function filesToDelete(
  entries: TmpFileEntry[],
  now: Date,
  maxAgeMs: number = TMP_MAX_AGE_MS
): string[] {
  const cutoff = now.getTime() - maxAgeMs;

  return entries
    .filter((entry) => {
      if (!entry.created_at) {
        return false;
      }

      return new Date(entry.created_at).getTime() <= cutoff;
    })
    .map((entry) => entry.name);
}

export async function cleanupTmp(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  now: Date = new Date()
): Promise<void> {
  try {
    const folder = `${tenantId}/tmp/${userId}`;
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, {
      limit: 1000,
    });

    if (error || !data?.length) {
      return;
    }

    const staleNames = filesToDelete(data, now, TMP_MAX_AGE_MS);
    if (!staleNames.length) {
      return;
    }

    const paths = staleNames.map((name) => `${folder}/${name}`);
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // Best-effort cleanup; callers must not fail when tmp removal fails.
  }
}
