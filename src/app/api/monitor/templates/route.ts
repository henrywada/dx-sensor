import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { SYSTEM_MONITOR_TEMPLATES } from "@/lib/monitor/systemTemplates";

export async function GET() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  return NextResponse.json(SYSTEM_MONITOR_TEMPLATES);
}
