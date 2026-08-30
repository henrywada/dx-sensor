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
      "id, user_id, tenant_id, prev_capture_id, curr_capture_id, diff_score, severity, ai_summary, email_queued, analysis_tool, created_at"
    )
    .eq("user_id", viewer.userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const events = data ?? [];
  if (events.length === 0) {
    return NextResponse.json([]);
  }

  const { data: orderedIds, error: orderError } = await supabase
    .from("auto_captures")
    .select("id")
    .eq("captured_by", viewer.userId)
    .order("created_at", { ascending: true });

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  const ordinalById = new Map<string, number>(
    (orderedIds ?? []).map((row, index) => [row.id as string, index + 1])
  );

  return NextResponse.json(
    events.map((event) => ({
      ...event,
      prev_capture_no: ordinalById.get(event.prev_capture_id) ?? null,
      curr_capture_no: ordinalById.get(event.curr_capture_id) ?? null,
    }))
  );
}
