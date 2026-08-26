import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("monitor_change_events")
    .select(
      "id, user_id, tenant_id, prev_capture_id, curr_capture_id, diff_score, severity, ai_summary, email_queued, created_at"
    )
    .eq("user_id", viewer.userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
