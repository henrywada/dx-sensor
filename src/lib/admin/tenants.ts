import { createServiceSupabase } from "@/lib/supabase/server";
import type { TenantListItem } from "@/lib/admin/tenantTypes";

export type { TenantListItem };
export {
  normalizeTenantSlug,
  isValidTenantSlug,
} from "@/lib/admin/tenantTypes";

export async function listTenantsDetailed(): Promise<TenantListItem[]> {
  const supabase = createServiceSupabase();

  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, name, slug, is_premium, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const { data: members, error: membersError } = await supabase
    .from("tenant_members")
    .select("tenant_id, id");
  if (membersError) throw membersError;

  const countByTenant = new Map<string, number>();
  for (const row of members ?? []) {
    const tid = row.tenant_id as string;
    countByTenant.set(tid, (countByTenant.get(tid) ?? 0) + 1);
  }

  return (tenants ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    isPremium: Boolean(row.is_premium),
    createdAt: row.created_at as string,
    memberCount: countByTenant.get(row.id as string) ?? 0,
  }));
}
