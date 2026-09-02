// src/app/api/line/invite-accept/route.ts
import { NextResponse } from "next/server";
import { establishSupabaseSession } from "@/lib/line/establishSupabaseSession";
import { verifyLineIdToken } from "@/lib/line/verifyLineIdToken";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { parseInviteAcceptBody } from "./parseBody";

export async function POST(req: Request) {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    console.error("NEXT_PUBLIC_LIFF_ID is not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  let parsed;
  try {
    parsed = parseInviteAcceptBody(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let lineUserId: string;
  try {
    ({ lineUserId } = await verifyLineIdToken(parsed.idToken, liffId));
  } catch {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }

  const service = createServiceSupabase();

  const { data: invite, error: inviteError } = await service
    .from("tenant_member_invites")
    .select("id, tenant_id, invitee_email, role, expires_at, used_at")
    .eq("invite_token", parsed.inviteToken)
    .maybeSingle();

  if (inviteError || !invite) {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }
  if (invite.used_at) {
    return NextResponse.json({ error: "already_used" }, { status: 401 });
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 401 });
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: invite.invitee_email,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    if (createError?.status === 422 || createError?.code === "email_exists") {
      // 既にauth.usersにいるメールアドレスへの招待は今回のスコープ外
      return NextResponse.json({ error: "email_already_registered" }, { status: 409 });
    }
    console.error("LINE invite-accept: createUser failed", createError);
    return NextResponse.json({ error: "account_creation_failed" }, { status: 500 });
  }

  const userId = created.user.id;

  const { error: memberError } = await service.from("tenant_members").insert({
    tenant_id: invite.tenant_id,
    user_id: userId,
    role: invite.role,
  });
  if (memberError) {
    console.error("LINE invite-accept: tenant_members insert failed", memberError);
    return NextResponse.json({ error: "account_creation_failed" }, { status: 500 });
  }

  await service.from("line_friends").upsert(
    {
      line_user_id: lineUserId,
      user_id: userId,
      tenant_id: invite.tenant_id,
      status: "linked",
      linked_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id" }
  );

  await service
    .from("tenant_member_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id);

  try {
    await establishSupabaseSession({
      adminClient: service,
      sessionClient: createServerSupabase(),
      email: invite.invitee_email,
    });
  } catch (sessionError) {
    console.error("LINE invite-accept: session establishment failed", sessionError);
    return NextResponse.json({ error: "session_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
