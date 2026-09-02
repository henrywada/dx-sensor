// src/app/api/line/friend-link-accept/route.ts
import { NextResponse } from "next/server";
import { verifyLineIdToken } from "@/lib/line/verifyLineIdToken";
import { createServiceSupabase } from "@/lib/supabase/server";
import { parseFriendLinkAcceptBody } from "./parseBody";

export async function POST(req: Request) {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) {
    console.error("LINE_LOGIN_CHANNEL_ID is not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  let parsed;
  try {
    parsed = parseFriendLinkAcceptBody(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let lineUserId: string;
  try {
    ({ lineUserId } = await verifyLineIdToken(parsed.idToken, channelId));
  } catch {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }

  const service = createServiceSupabase();

  const { data: invite, error: inviteError } = await service
    .from("line_friend_invites")
    .select("id, tenant_id, user_id, expires_at, used_at")
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

  const { data: claimed, error: claimError } = await service
    .from("line_friend_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("used_at", null)
    .select("id");

  if (claimError) {
    console.error("friend-link-accept: used_at claim failed", claimError);
    return NextResponse.json({ error: "link_failed" }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "already_used" }, { status: 401 });
  }

  const { data: existingFriend, error: existingFriendError } = await service
    .from("line_friends")
    .select("user_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (existingFriendError) {
    console.error("friend-link-accept: line_friends lookup failed", existingFriendError);
    return NextResponse.json({ error: "link_failed" }, { status: 500 });
  }
  if (existingFriend?.user_id && existingFriend.user_id !== invite.user_id) {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }

  const { error: upsertError } = await service.from("line_friends").upsert(
    {
      line_user_id: lineUserId,
      user_id: invite.user_id,
      tenant_id: invite.tenant_id,
      status: "linked",
      linked_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id" }
  );

  if (upsertError) {
    console.error("friend-link-accept: line_friends upsert failed", upsertError);
    return NextResponse.json({ error: "link_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
