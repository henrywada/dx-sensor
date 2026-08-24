import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { AnalysisError, runAnalysis } from "@/lib/image-analysis/runAnalysis";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseAnalyzeRequest } from "./parseAnalyzeRequest";

export async function POST(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return NextResponse.json({ error: "所属テナントが見つかりません" }, { status: 403 });
  }

  let parsed;
  try {
    parsed = parseAnalyzeRequest(await req.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { data: capture, error: captureError } = await supabase
    .from("manual_captures")
    .select("id, storage_path")
    .eq("id", parsed.captureId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle();

  if (captureError || !capture) {
    return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from("manual-captures")
    .download(capture.storage_path);

  if (downloadError || !file) {
    return NextResponse.json({ error: "画像の読み込みに失敗しました" }, { status: 500 });
  }

  try {
    const result = await runAnalysis(parsed.provider, {
      imageBuffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || "image/jpeg",
      prompt: parsed.prompt,
    });
    return NextResponse.json({
      text: result.text,
      provider: parsed.provider,
      prompt: parsed.prompt,
      estimatedCostYen: result.estimatedCostYen ?? null,
    });
  } catch (err) {
    if (err instanceof AnalysisError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : "解析に失敗しました";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
