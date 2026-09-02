// src/app/api/line/liff-auth/parseBody.ts
export type ParsedLiffAuthBody = { idToken: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLiffAuthBody(body: unknown): ParsedLiffAuthBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { idToken } = body;
  if (typeof idToken !== "string" || idToken.length === 0) {
    throw new Error("invalid idToken");
  }

  return { idToken };
}
