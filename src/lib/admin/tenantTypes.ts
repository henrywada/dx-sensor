export type TenantListItem = {
  id: string;
  name: string;
  slug: string;
  isPremium: boolean;
  createdAt: string;
  memberCount: number;
};

/** slug: lowercase letters, digits, hyphen; 2–64 chars */
export function normalizeTenantSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isValidTenantSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug) && slug.length >= 2;
}
