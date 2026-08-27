import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Session refresh only for app pages. Skip static assets, cron/ingest
     * (no browser session), and Next internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/cron|api/ingest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
