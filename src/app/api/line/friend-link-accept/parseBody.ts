// src/app/api/line/friend-link-accept/parseBody.ts
export type ParsedFriendLinkAcceptBody = { idToken: string; inviteToken: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFriendLinkAcceptBody(body: unknown): ParsedFriendLinkAcceptBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { idToken, inviteToken } = body;
  if (typeof idToken !== "string" || idToken.length === 0) {
    throw new Error("invalid idToken");
  }
  if (typeof inviteToken !== "string" || inviteToken.length === 0) {
    throw new Error("invalid inviteToken");
  }

  return { idToken, inviteToken };
}
