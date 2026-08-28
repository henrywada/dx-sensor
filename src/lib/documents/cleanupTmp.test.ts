import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TMP_MAX_AGE_MS,
  cleanupTmp,
  filesToDelete,
} from "./cleanupTmp";

describe("filesToDelete", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("exports 24h as the default max age", () => {
    expect(TMP_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("includes files older than maxAgeMs", () => {
    const entries = [
      {
        name: "old.jpg",
        created_at: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
      },
    ];

    expect(filesToDelete(entries, now, TMP_MAX_AGE_MS)).toEqual(["old.jpg"]);
  });

  it("excludes files newer than maxAgeMs", () => {
    const entries = [
      {
        name: "recent.jpg",
        created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      },
    ];

    expect(filesToDelete(entries, now, TMP_MAX_AGE_MS)).toEqual([]);
  });

  it("excludes files with missing created_at", () => {
    const entries = [{ name: "unknown.jpg" }, { name: "null.jpg", created_at: null }];

    expect(filesToDelete(entries, now, TMP_MAX_AGE_MS)).toEqual([]);
  });
});

describe("cleanupTmp", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  const now = new Date("2026-08-28T12:00:00Z");

  function makeSupabase(options: {
    listData?: Array<{ name: string; created_at?: string | null }>;
    listError?: { message: string } | null;
    removeError?: { message: string } | null;
  }) {
    const remove = vi.fn().mockResolvedValue({ data: [], error: options.removeError ?? null });
    const list = vi.fn().mockResolvedValue({
      data: options.listData ?? [],
      error: options.listError ?? null,
    });

    const from = vi.fn().mockReturnValue({ list, remove });

    return {
      supabase: { storage: { from } } as unknown as SupabaseClient,
      list,
      remove,
      from,
    };
  }

  it("lists the tenant/user tmp folder, deletes stale files, and ignores fresh ones", async () => {
    const { supabase, list, remove, from } = makeSupabase({
      listData: [
        {
          name: "old.jpg",
          created_at: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
        },
        {
          name: "recent.jpg",
          created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });

    await cleanupTmp(supabase, tenantId, userId, now);

    expect(from).toHaveBeenCalledWith("captured-documents");
    expect(list).toHaveBeenCalledWith(`${tenantId}/tmp/${userId}`, {
      limit: 1000,
    });
    expect(remove).toHaveBeenCalledWith([
      `${tenantId}/tmp/${userId}/old.jpg`,
    ]);
  });

  it("ignores list failures", async () => {
    const { supabase, remove } = makeSupabase({
      listError: { message: "list failed" },
    });

    await expect(cleanupTmp(supabase, tenantId, userId, now)).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it("ignores remove failures", async () => {
    const { supabase, remove } = makeSupabase({
      listData: [
        {
          name: "old.jpg",
          created_at: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
        },
      ],
      removeError: { message: "remove failed" },
    });

    await expect(cleanupTmp(supabase, tenantId, userId, now)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledOnce();
  });
});
