export type LineTextMessage = { type: "text"; text: string };

export function buildFollowReplyMessage(liffId: string): LineTextMessage[] {
  return [
    {
      type: "text",
      text: `友だち追加ありがとうございます。\n下のリンクからdx-sensorにアクセスできます。\nhttps://liff.line.me/${liffId}/entry`,
    },
  ];
}
