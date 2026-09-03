import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { generateInviteToken, inviteExpiryDate } from "@/lib/line/inviteToken";
import { createServiceSupabase } from "@/lib/supabase/server";
import { buildSignupTenantIdentity } from "@/lib/tenant/signupTenantIdentity";

export async function POST() {
  const viewer = await getViewerContext();
  if (!viewer.userId || !viewer.email) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const userId = viewer.userId;
  const email = viewer.email;
  const service = createServiceSupabase();

  const existingTenant = await getActiveTenant(userId);
  let tenantId: string;

  if (existingTenant) {
    tenantId = existingTenant.tenantId;
  } else {
    const { name, slug } = buildSignupTenantIdentity(email, userId);

    const { data: tenant, error: tenantError } = await service
      .from("tenants")
      .insert({ name, slug, tenant_type: "free", is_premium: false })
      .select("id")
      .single();

    if (tenantError || !tenant) {
      console.error("signup/provision: tenants insert failed", tenantError);
      return NextResponse.json({ error: "tenant_creation_failed" }, { status: 500 });
    }

    const { error: memberError } = await service.from("tenant_members").insert({
      tenant_id: tenant.id,
      user_id: userId,
      role: "owner",
    });

    if (memberError) {
      console.error("signup/provision: tenant_members insert failed", memberError);
      const { error: rollbackError } = await service
        .from("tenants")
        .delete()
        .eq("id", tenant.id);
      if (rollbackError) {
        console.error("signup/provision: tenant rollback delete failed", rollbackError);
      }
      return NextResponse.json({ error: "member_creation_failed" }, { status: 500 });
    }

    tenantId = tenant.id;
  }

  const { data: friend } = await service
    .from("line_friends")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "linked")
    .maybeSingle();

  if (friend) {
    return NextResponse.json({ redirectTo: "/" });
  }

  const inviteToken = generateInviteToken();
  const expiresAt = inviteExpiryDate();

  const { error: inviteError } = await service.from("line_friend_invites").insert({
    tenant_id: tenantId,
    user_id: userId,
    invite_token: inviteToken,
    created_by: userId,
    expires_at: expiresAt.toISOString(),
  });

  if (inviteError) {
    console.error("signup/provision: line_friend_invites insert failed", inviteError);
    return NextResponse.json({ error: "invite_creation_failed" }, { status: 500 });
  }

  return NextResponse.json({ inviteUrl: `/line-friend-invite/${inviteToken}` });
}
