import { createServerSupabase } from "@/lib/supabase/server";

export interface ActiveTenant {
  tenantId: string;
  role: "owner" | "admin" | "viewer" | "developer" | "admin_tenant";
}

/**
 * Resolves the tenant a logged-in user is acting within.
 *
 * Deliberately kept separate from getViewerContext (which only resolves
 * login state / developer role) so that tenant resolution stays a single,
 * swappable concern.
 *
 * MVP assumption: a user belongs to exactly one tenant, so we take the
 * first tenant_members row. If multi-tenant-per-user becomes a real case,
 * this is the single place to add a tenant switcher / active-tenant cookie.
 */
export async function getActiveTenant(
  userId: string
): Promise<ActiveTenant | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return { tenantId: data.tenant_id, role: data.role };
}
