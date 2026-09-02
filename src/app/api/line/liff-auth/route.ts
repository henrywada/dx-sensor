// src/app/api/line/liff-auth/route.ts
import { NextResponse } from "next/server";
import { establishSupabaseSession } from "@/lib/line/establishSupabaseSession";
import { verifyLineIdToken } from "@/lib/line/verifyLineIdToken";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { parseLiffAuthBody } from "./parseBody";

export async function POST(req: Request) {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    console.error("NEXT_PUBLIC_LIFF_ID is not configured");
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
    ({ lineUserId } = await verifyLineIdToken(parsed.idToken, liffId));
  } catch {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }

  const service = createServiceSupabase();

  const { data: friend, error: friendError } = await service
    .from("line_friends")
    .select("user_id, status")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (friendError || !friend || friend.status !== "linked" || !friend.user_id) {
    return NextResponse.json({ error: "not_linked" }, { status: 401 });
  }

  const { data: userData, error: userError } = await service.auth.admin.getUserById(
    friend.user_id
  );
  if (userError || !userData?.user?.email) {
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
