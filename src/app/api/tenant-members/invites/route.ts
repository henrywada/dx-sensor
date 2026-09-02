import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { generateInviteToken, inviteExpiryDate } from "@/lib/line/inviteToken";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseInviteBody } from "./parseBody";

export async function POST(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = parseInviteBody(await req.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const inviteToken = generateInviteToken();
  const expiresAt = inviteExpiryDate();

  const { error } = await supabase.from("tenant_member_invites").insert({
    tenant_id: parsed.tenantId,
    invitee_email: parsed.inviteeEmail,
    role: parsed.role,
    invite_token: inviteToken,
    created_by: viewer.userId,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    // RLS(has_tenant_role(tenant_id, 'admin'))で弾かれた場合もここに来る
    return NextResponse.json({ error: "招待の発行に失敗しました" }, { status: 403 });
  }

  const inviteUrl = `${new URL(req.url).origin}/liff/link?t=${inviteToken}`;
  return NextResponse.json({ inviteUrl }, { status: 201 });
}
