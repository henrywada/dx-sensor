export const MEMBER_ROLES = ["owner", "admin", "viewer", "developer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type TenantOption = {
  id: string;
  name: string;
  slug: string;
};

export type MemberRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  userId: string;
  email: string;
  role: MemberRole;
  createdAt: string;
};

export function isMemberRole(value: string): value is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(value);
}
