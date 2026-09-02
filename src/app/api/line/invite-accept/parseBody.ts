// src/app/api/line/invite-accept/parseBody.ts
export type ParsedInviteAcceptBody = { idToken: string; inviteToken: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInviteAcceptBody(body: unknown): ParsedInviteAcceptBody {
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
