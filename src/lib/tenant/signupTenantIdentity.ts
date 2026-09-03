const SLUG_INVALID_CHARS = /[^a-z0-9-]/g;
const MAX_NAME_LENGTH = 60;

export function buildSignupTenantIdentity(
  email: string,
  userId: string
): { name: string; slug: string } {
  const localPart = email.split("@")[0] || "user";
  const name = localPart.slice(0, MAX_NAME_LENGTH);

  const normalized = localPart
    .toLowerCase()
    .replace(SLUG_INVALID_CHARS, "-")
    .slice(0, MAX_NAME_LENGTH);
  const suffix = userId.replace(/-/g, "");
  const slug = `${normalized}-${suffix}`;

  return { name, slug };
}
