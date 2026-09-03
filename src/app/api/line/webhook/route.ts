import { NextResponse } from "next/server";
import { parseWebhookEvents } from "@/lib/line/parseWebhookEvents";
import { verifyLineWebhookSignature } from "@/lib/line/verifyWebhookSignature";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  if (!channelSecret) {
    console.error("LINE env vars are not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  const isValid = verifyLineWebhookSignature({
    rawBody,
    signatureHeader: signature,
    channelSecret,
  });
  if (!isValid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let events;
  try {
    events = parseWebhookEvents(JSON.parse(rawBody));
  } catch {
    // 個人情報を含みうるペイロードはログしない
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const supabase = createServiceSupabase();

  for (const event of events) {
    if (event.type === "follow") {
      const { data: existing } = await supabase
        .from("line_friends")
        .select("id, status, user_id")
        .eq("line_user_id", event.source.userId)
        .maybeSingle();

      if (!existing) {
        await supabase.from("line_friends").insert({
          line_user_id: event.source.userId,
          status: "unlinked",
        });
      } else if (existing.status === "blocked") {
        await supabase
          .from("line_friends")
          .update({ status: existing.user_id ? "linked" : "unlinked" })
          .eq("id", existing.id);
      }
      // 友だち追加時の案内メッセージはLINE公式アカウント側の
      // 「あいさつメッセージ」機能が送信するため、ここでは送信しない
      // (Webhookのreply APIと同じreplyTokenを取り合い、競合していたため)
    } else if (event.type === "unfollow") {
      await supabase
        .from("line_friends")
        .update({ status: "blocked" })
        .eq("line_user_id", event.source.userId);
    }
    // "message"イベントは自由対話を実装しないため無視する
  }

  return NextResponse.json({ ok: true });
}
