export type ParsedFriendInviteBody = { userIds: string[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFriendInviteBody(body: unknown): ParsedFriendInviteBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { userIds } = body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new Error("invalid userIds");
  }
  for (const userId of userIds) {
    if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
      throw new Error("invalid userIds");
    }
  }

  return { userIds: [...new Set(userIds)] };
}
