// src/app/api/line/liff-auth/route.ts
import { NextResponse } from "next/server";
import { establishSupabaseSession } from "@/lib/line/establishSupabaseSession";
import { verifyLineIdToken } from "@/lib/line/verifyLineIdToken";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { parseLiffAuthBody } from "./parseBody";

export async function POST(req: Request) {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) {
    console.error("LINE_LOGIN_CHANNEL_ID is not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  let parsed;
  try {
    parsed = parseLiffAuthBody(await req.json());
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

  const { data: friend, error: friendError } = await service
    .from("line_friends")
    .select("user_id, tenant_id, status")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (friendError || !friend || friend.status !== "linked" || !friend.user_id) {
    if (friendError) {
      console.error("LINE liff-auth: line_friends lookup failed", friendError);
    }
    return NextResponse.json({ error: "not_linked" }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await service
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", friend.tenant_id)
    .eq("user_id", friend.user_id)
    .maybeSingle();

  if (membershipError || !membership) {
    if (membershipError) {
      console.error("LINE liff-auth: tenant_members lookup failed", membershipError);
    }
    return NextResponse.json({ error: "not_linked" }, { status: 401 });
  }

  const { data: userData, error: userError } = await service.auth.admin.getUserById(
    friend.user_id
  );
  if (userError || !userData?.user?.email) {
    if (userError) {
      console.error("LINE liff-auth: getUserById failed", userError);
    }
    return NextResponse.json({ error: "not_linked" }, { status: 401 });
  }

  try {
    await establishSupabaseSession({
      adminClient: service,
      sessionClient: createServerSupabase(),
      email: userData.user.email,
    });
  } catch (sessionError) {
    console.error("LINE liff-auth: session establishment failed", sessionError);
    return NextResponse.json({ error: "session_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
