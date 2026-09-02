export type LineWebhookEvent =
  | { type: "follow"; replyToken: string; source: { userId: string } }
  | { type: "unfollow"; source: { userId: string } }
  | { type: "message"; replyToken: string; source: { userId: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSourceUserId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.userId !== "string") return null;
  return value.userId;
}

export function parseWebhookEvents(body: unknown): LineWebhookEvent[] {
  if (!isRecord(body) || !Array.isArray(body.events)) {
    throw new Error("invalid webhook body");
  }

  return body.events.flatMap((event): LineWebhookEvent[] => {
    if (!isRecord(event) || typeof event.type !== "string") return [];

    if (event.type === "follow" || event.type === "message") {
      const userId = parseSourceUserId(event.source);
      if (typeof event.replyToken !== "string" || !userId) return [];
      return [{ type: event.type, replyToken: event.replyToken, source: { userId } }];
    }

    if (event.type === "unfollow") {
      const userId = parseSourceUserId(event.source);
      if (!userId) return [];
      return [{ type: "unfollow", source: { userId } }];
    }

    return [];
  });
}
