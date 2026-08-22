import { createServerSupabase } from "@/lib/supabase/server";

export interface ViewerContext {
  userId: string | null;
  email: string | null;
  isDeveloper: boolean;
}

/**
 * Determines whether the current visitor is logged in and, if so, whether
 * they hold the 'developer' role (see tenant_members.role in migration 0001).
 *
 * Deliberately does NOT hardcode an email address. The project's own
 * convention (established from the start — see CLAUDE.md) is role-column-based
 * developer access via tenant_members, specifically to avoid hardcoded-email
 * checks scattered through the codebase. Today only wada007@gmail.com holds
 * that role, so the visible effect is identical to an email check — but this
 * way it stays correct if a second developer account is ever added, and
 * there's only one place (the tenant_members table) that defines who counts.
 */
export async function getViewerContext(): Promise<ViewerContext> {
  const supabase = createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: null, email: null, isDeveloper: false };
  }

  const { data: isDeveloper } = await supabase.rpc("is_app_developer");

  return {
    userId: user.id,
    email: user.email ?? null,
    isDeveloper: Boolean(isDeveloper),
  };
}
