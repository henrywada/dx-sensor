import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { buildFriendInviteEmail } from "@/lib/email/buildFriendInviteEmail";
import { sendEmail, type EmailClient } from "@/lib/email/sendEmail";
import { generateInviteToken, inviteExpiryDate } from "@/lib/line/inviteToken";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { parseFriendInviteBody } from "./parseBody";

const ADMIN_ROLES = new Set(["owner", "admin", "developer"]);

type SendResult = { userId: string; ok: boolean; error?: string };

export async function POST(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant || !ADMIN_ROLES.has(tenant.role)) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  let parsed;
  try {
    parsed = parseFriendInviteBody(await req.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  if (!resendApiKey || !emailFrom) {
    console.error("Resend env vars are not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const rls = createServerSupabase();
  const service = createServiceSupabase();
  const resend = new Resend(resendApiKey);
  const origin = new URL(req.url).origin;

  const { data: tenantRow } = await service
    .from("tenants")
    .select("name")
    .eq("id", tenant.tenantId)
    .maybeSingle();
  const tenantName = tenantRow?.name ?? "dx-sensor";

  const results: SendResult[] = [];

  for (const userId of parsed.userIds) {
    const { data: member } = await rls
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenant.tenantId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!member) {
      results.push({ userId, ok: false, error: "not_a_member" });
      continue;
    }

    const { data: userData, error: userError } = await service.auth.admin.getUserById(userId);
    if (userError || !userData?.user?.email) {
      console.error("friend-invites: getUserById failed", userError);
      results.push({ userId, ok: false, error: "email_not_found" });
      continue;
    }

    const inviteToken = generateInviteToken();
    const expiresAt = inviteExpiryDate();

    const { error: insertError } = await service.from("line_friend_invites").insert({
      tenant_id: tenant.tenantId,
      user_id: userId,
      invite_token: inviteToken,
      created_by: viewer.userId,
      expires_at: expiresAt.toISOString(),
    });

    if (insertError) {
      console.error("friend-invites: line_friend_invites insert failed", insertError);
      results.push({ userId, ok: false, error: "invite_creation_failed" });
      continue;
    }

    const inviteUrl = `${origin}/line-friend-invite/${inviteToken}`;
    const { subject, html } = buildFriendInviteEmail({ tenantName, inviteUrl });

    const sendResult = await sendEmail({
      // ResendのSDK型とEmailClient(テスト用に薄く定義した型)は完全一致しないため、
      // 実クライアントを渡す境界でのみキャストする。
      client: resend as unknown as EmailClient,
      from: emailFrom,
      to: userData.user.email,
      subject,
      html,
    });

    if (!sendResult.ok) {
      console.error("friend-invites: sendEmail failed", sendResult.error);
    }

    results.push(
      sendResult.ok
        ? { userId, ok: true }
        : { userId, ok: false, error: "email_send_failed" }
    );
  }

  return NextResponse.json({ results }, { status: 200 });
}
