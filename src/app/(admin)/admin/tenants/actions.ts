"use server";

import { revalidatePath } from "next/cache";
import {
  isValidTenantSlug,
  normalizeTenantSlug,
} from "@/lib/admin/tenantTypes";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { createServiceSupabase } from "@/lib/supabase/server";

export type TenantActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

async function requireDeveloper(): Promise<TenantActionResult | null> {
  const viewer = await getViewerContext();
  if (!viewer.isDeveloper) {
    return { ok: false, error: "開発者権限が必要です。" };
  }
  return null;
}

export async function createTenantAction(input: {
  name: string;
  slug: string;
  isPremium: boolean;
}): Promise<TenantActionResult> {
  const denied = await requireDeveloper();
  if (denied) return denied;

  const name = input.name?.trim();
  const slug = normalizeTenantSlug(input.slug ?? "");

  if (!name) return { ok: false, error: "テナント名を入力してください。" };
  if (!isValidTenantSlug(slug)) {
    return {
      ok: false,
      error:
        "スラッグは半角英小文字・数字・ハイフン、2文字以上で入力してください。",
    };
  }

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("tenants").insert({
    name,
    slug,
    is_premium: Boolean(input.isPremium),
    tenant_type: input.isPremium ? "premium" : "free",
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "同じスラッグのテナントが既に存在します。" };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/tenants");
  revalidatePath("/admin/members");
  return { ok: true, message: "テナントを作成しました。" };
}

export async function updateTenantAction(input: {
  tenantId: string;
  name: string;
  slug: string;
  isPremium: boolean;
}): Promise<TenantActionResult> {
  const denied = await requireDeveloper();
  if (denied) return denied;

  const tenantId = input.tenantId?.trim();
  const name = input.name?.trim();
  const slug = normalizeTenantSlug(input.slug ?? "");

  if (!tenantId) return { ok: false, error: "テナント ID が不正です。" };
  if (!name) return { ok: false, error: "テナント名を入力してください。" };
  if (!isValidTenantSlug(slug)) {
    return {
      ok: false,
      error:
        "スラッグは半角英小文字・数字・ハイフン、2文字以上で入力してください。",
    };
  }

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("tenants")
    .update({
      name,
      slug,
      is_premium: Boolean(input.isPremium),
      tenant_type: input.isPremium ? "premium" : "free",
    })
    .eq("id", tenantId)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "同じスラッグのテナントが既に存在します。" };
    }
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "対象テナントが見つかりませんでした。" };
  }

  revalidatePath("/admin/tenants");
  revalidatePath("/admin/members");
  return { ok: true, message: "テナントを更新しました。" };
}
