export type ParsedInviteBody = {
  tenantId: string;
  inviteeEmail: string;
  role: "owner" | "admin" | "viewer";
};

const ALLOWED_ROLES = new Set(["owner", "admin", "viewer"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInviteBody(body: unknown): ParsedInviteBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { tenantId, inviteeEmail, role } = body;

  if (typeof tenantId !== "string" || !UUID_PATTERN.test(tenantId)) {
    throw new Error("invalid tenantId");
  }
  if (typeof inviteeEmail !== "string" || !EMAIL_PATTERN.test(inviteeEmail)) {
    throw new Error("invalid inviteeEmail");
  }
  if (typeof role !== "string" || !ALLOWED_ROLES.has(role)) {
    throw new Error("invalid role");
  }

  return {
    tenantId,
    inviteeEmail: inviteeEmail.trim().toLowerCase(),
    role: role as ParsedInviteBody["role"],
  };
}
