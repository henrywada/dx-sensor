import type { LineTextMessage } from "./buildFollowReplyMessage";

const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

export async function replyLineMessage(params: {
  channelAccessToken: string;
  replyToken: string;
  messages: LineTextMessage[];
}): Promise<void> {
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken: params.replyToken,
      messages: params.messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("LINE reply message failed", response.status, text);
    throw new Error(`LINE reply failed: ${response.status}`);
  }
}
