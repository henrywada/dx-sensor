const SLUG_INVALID_CHARS = /[^a-z0-9-]/g;

export function buildSignupTenantIdentity(
  email: string,
  userId: string
): { name: string; slug: string } {
  const localPart = email.split("@")[0] || "user";
  const name = localPart;

  const normalized = localPart.toLowerCase().replace(SLUG_INVALID_CHARS, "-");
  const suffix = userId.replace(/-/g, "");
  const slug = `${normalized}-${suffix}`;

  return { name, slug };
}
