"use server";

import { revalidatePath } from "next/cache";
import {
  findAuthUserIdByEmail,
  generateTempPassword,
} from "@/lib/admin/members";
import { MEMBER_ROLES, type MemberRole } from "@/lib/admin/memberTypes";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { createServiceSupabase } from "@/lib/supabase/server";

export type MemberActionResult =
  | { ok: true; message?: string; tempPassword?: string }
  | { ok: false; error: string };

async function requireDeveloper(): Promise<MemberActionResult | null> {
  const viewer = await getViewerContext();
  if (!viewer.isDeveloper) {
    return { ok: false, error: "開発者権限が必要です。" };
  }
  return null;
}

function parseRole(value: unknown): MemberRole | null {
  if (typeof value !== "string") return null;
  return (MEMBER_ROLES as readonly string[]).includes(value)
    ? (value as MemberRole)
    : null;
}

async function countOwners(
  supabase: ReturnType<typeof createServiceSupabase>,
  tenantId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("tenant_members")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", "owner");
  if (error) throw error;
  return count ?? 0;
}

export async function addMemberAction(input: {
  tenantId: string;
  email: string;
  role: string;
}): Promise<MemberActionResult> {
  const denied = await requireDeveloper();
  if (denied) return denied;

  const tenantId = input.tenantId?.trim();
  const email = input.email?.trim().toLowerCase();
  const role = parseRole(input.role);

  if (!tenantId) return { ok: false, error: "テナントを選択してください。" };
  if (!email || !email.includes("@")) {
    return { ok: false, error: "有効なメールアドレスを入力してください。" };
  }
  if (!role) return { ok: false, error: "ロールが不正です。" };

  const supabase = createServiceSupabase();

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError) return { ok: false, error: tenantError.message };
  if (!tenant) return { ok: false, error: "テナントが見つかりません。" };

  let userId = await findAuthUserIdByEmail(email);
  let tempPassword: string | undefined;
  let createdNewUser = false;

  if (!userId) {
    tempPassword = generateTempPassword();
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });
    if (createError) {
      return { ok: false, error: `ユーザー作成に失敗: ${createError.message}` };
    }
    userId = created.user?.id ?? null;
    if (!userId) {
      return { ok: false, error: "ユーザー作成後の ID を取得できませんでした。" };
    }
    createdNewUser = true;
  }

  const { error: insertError } = await supabase.from("tenant_members").insert({
    tenant_id: tenantId,
    user_id: userId,
    role,
  });

  if (insertError) {
    if (createdNewUser && userId) {
      await supabase.auth.admin.deleteUser(userId);
    }
    if (insertError.code === "23505") {
      return {
        ok: false,
        error: "このユーザーは既にそのテナントのメンバーです。",
      };
    }
    return { ok: false, error: insertError.message };
  }

  revalidatePath("/admin/members");

  if (tempPassword) {
    return {
      ok: true,
      message: "新規ユーザーを作成し、メンバーに追加しました。",
      tempPassword,
    };
  }
  return { ok: true, message: "メンバーを追加しました。" };
}

export async function updateMemberRoleAction(input: {
  memberId: string;
  role: string;
}): Promise<MemberActionResult> {
  const denied = await requireDeveloper();
  if (denied) return denied;

  const memberId = input.memberId?.trim();
  const role = parseRole(input.role);
  if (!memberId) return { ok: false, error: "メンバー ID が不正です。" };
  if (!role) return { ok: false, error: "ロールが不正です。" };

  const supabase = createServiceSupabase();

  const { data: member, error: memberError } = await supabase
    .from("tenant_members")
    .select("id, tenant_id, role")
    .eq("id", memberId)
    .maybeSingle();
  if (memberError) return { ok: false, error: memberError.message };
  if (!member) return { ok: false, error: "メンバーが見つかりません。" };

  if (member.role === "owner" && role !== "owner") {
    try {
      const owners = await countOwners(supabase, member.tenant_id as string);
      if (owners <= 1) {
        return {
          ok: false,
          error: "テナントの最後の owner は降格できません。",
        };
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "owner 数の確認に失敗しました。",
      };
    }
  }

  const { error } = await supabase
    .from("tenant_members")
    .update({ role })
    .eq("id", memberId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: "ロールを更新しました。" };
}

export async function removeMemberAction(input: {
  memberId: string;
}): Promise<MemberActionResult> {
  const denied = await requireDeveloper();
  if (denied) return denied;

  const memberId = input.memberId?.trim();
  if (!memberId) return { ok: false, error: "メンバー ID が不正です。" };

  const supabase = createServiceSupabase();

  const { data: member, error: memberError } = await supabase
    .from("tenant_members")
    .select("id, tenant_id, role")
    .eq("id", memberId)
    .maybeSingle();
  if (memberError) return { ok: false, error: memberError.message };
  if (!member) return { ok: false, error: "メンバーが見つかりません。" };

  if (member.role === "owner") {
    try {
      const owners = await countOwners(supabase, member.tenant_id as string);
      if (owners <= 1) {
        return {
          ok: false,
          error: "テナントの最後の owner は削除できません。",
        };
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "owner 数の確認に失敗しました。",
      };
    }
  }

  const { error } = await supabase
    .from("tenant_members")
    .delete()
    .eq("id", memberId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/members");
  return { ok: true, message: "メンバーを削除しました。" };
}
