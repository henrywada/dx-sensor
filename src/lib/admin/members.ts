import { createServiceSupabase } from "@/lib/supabase/server";
import {
  isMemberRole,
  type MemberRole,
  type MemberRow,
  type TenantOption,
} from "@/lib/admin/memberTypes";

export type { MemberRole, MemberRow, TenantOption };
export { MEMBER_ROLES, isMemberRole } from "@/lib/admin/memberTypes";

async function listAuthEmailMap(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const perPage = 1000;
  let page = 1;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      map.set(user.id, user.email ?? "");
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  return map;
}

export async function listTenants(): Promise<TenantOption[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
  }));
}

export async function listMembers(tenantId?: string | null): Promise<MemberRow[]> {
  const supabase = createServiceSupabase();
  let query = supabase
    .from("tenant_members")
    .select("id, tenant_id, user_id, role, created_at, tenants(name, slug)")
    .order("created_at", { ascending: false });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const emailById = await listAuthEmailMap(supabase);

  return (data ?? []).map((row) => {
    const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
    const role = isMemberRole(String(row.role)) ? (row.role as MemberRole) : "viewer";
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      tenantName: (tenant?.name as string) ?? "(不明)",
      tenantSlug: (tenant?.slug as string) ?? "",
      userId: row.user_id as string,
      email: emailById.get(row.user_id as string) ?? "(メール不明)",
      role,
      createdAt: row.created_at as string,
    };
  });
}

export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const supabase = createServiceSupabase();
  const normalized = email.trim().toLowerCase();
  const emailById = await listAuthEmailMap(supabase);
  for (const [id, userEmail] of emailById) {
    if (userEmail.toLowerCase() === normalized) return id;
  }
  return null;
}

export function generateTempPassword(length = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
