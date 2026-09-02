import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** RLS-scoped client for use in Server Components / Route Handlers on behalf of a logged-in user. */
export function createServerSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot always write cookies; middleware refreshes sessions.
          }
        },
      },
    }
  );
}

/**
 * Service-role client — bypasses RLS. Only use in:
 *  - Vercel Cron jobs (snapshot ingestion, ANPR pipeline)
 *  - server-side jobs that write vehicle_events on behalf of the system
 *  - LINE連携の認証フロー(api/line/webhook, api/line/invite-accept, api/line/liff-auth) —
 *    line_friends/tenant_member_invitesの読み書きとauth.users作成にservice_roleが必要なため
 * Never expose this client or its key to the browser.
 */
export function createServiceSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
