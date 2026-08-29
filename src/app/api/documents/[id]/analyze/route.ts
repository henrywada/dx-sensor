import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { canMutateDocument } from "@/lib/documents/canMutateDocument";
import type { LineItemDraft } from "@/lib/documents/pluginTypes";
import { resolveDocumentPlugin } from "@/lib/documents/resolvePlugin";
import { BUCKET } from "@/lib/documents/storagePaths";
import { estimateCostYen, extractTokenUsage } from "@/lib/image-analysis/estimateCostYen";
import {
  type DocumentOcrImage,
  ocrDocument,
} from "@/lib/image-analysis/document-ocr/documentOcr";
import { createServerSupabase } from "@/lib/supabase/server";

type RouteContext = {
  params: { id: string };
};

type DocumentRow = {
  id: string;
  owner_user_id: string;
  document_type: string;
  document_mode: string | null;
  company_visible: boolean;
};

type ImageRow = {
  role: string;
  sort_order: number;
  storage_path: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function downloadImage(
  supabase: ReturnType<typeof createServerSupabase>,
  path: string
): Promise<DocumentOcrImage> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error("画像の読み込みに失敗しました");
  }

  return {
    imageBuffer: Buffer.from(await data.arrayBuffer()),
    mimeType: data.type || "image/jpeg",
  };
}

export async function POST(_req: Request, { params }: RouteContext) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return NextResponse.json({ error: "所属テナントが見つかりません" }, { status: 403 });
  }

  if (!uuidPattern.test(params.id)) {
    return NextResponse.json({ error: "文書が見つかりません" }, { status: 404 });
  }

  const supabase = createServerSupabase();
  const { data: document, error: documentError } = await supabase
    .from("captured_documents")
    .select("id, owner_user_id, document_type, document_mode, company_visible")
    .eq("id", params.id)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle();

  if (documentError) {
    console.error("captured document fetch failed", documentError);
    return NextResponse.json({ error: "文書の取得に失敗しました" }, { status: 500 });
  }
  if (!document) {
    return NextResponse.json({ error: "文書が見つかりません" }, { status: 404 });
  }

  const row = document as DocumentRow;
  if (
    !canMutateDocument({
      actorUserId: viewer.userId,
      actorRole: tenant.role,
      isDeveloper: viewer.isDeveloper,
      ownerUserId: row.owner_user_id,
      companyVisible: row.company_visible,
    })
  ) {
    return NextResponse.json({ error: "文書を更新する権限がありません" }, { status: 403 });
  }

  const resolved = resolveDocumentPlugin(row.document_type, row.document_mode);
  if (!resolved) {
    return NextResponse.json({ error: "文書種別が不正です" }, { status: 400 });
  }
  const plugin = resolved.plugin;

  const { data: images, error: imageError } = await supabase
    .from("captured_document_images")
    .select("role, sort_order, storage_path")
    .eq("document_id", row.id)
    .order("sort_order", { ascending: true });

  if (imageError) {
    console.error("captured_document_images fetch failed", imageError);
    return NextResponse.json({ error: "文書画像の取得に失敗しました" }, { status: 500 });
  }

  const imageRows = (images ?? []) as ImageRow[];

  if (!plugin.structuredOcr) {
    const frontPath = imageRows.find((image) => image.role === "front")?.storage_path;
    if (!frontPath) {
      return NextResponse.json({ error: "文書画像が見つかりません" }, { status: 404 });
    }
  } else {
    const pageCount = imageRows.filter((image) => image.role === "page").length;
    if (pageCount === 0) {
      return NextResponse.json({ error: "文書画像が見つかりません" }, { status: 404 });
    }
  }

  let extracted: Record<string, string>;
  let lineItems: LineItemDraft[] | undefined;
  let rawOcr = "";
  let raw: unknown = null;
  let warning: "ocr_failed" | undefined;

  if (plugin.structuredOcr) {
    lineItems = [];
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY が未設定です");
    }

    const model = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

    if (plugin.structuredOcr) {
      const pageRows = imageRows.filter((image) => image.role === "page");
      const pages = await Promise.all(
        pageRows.map((image) => downloadImage(supabase, image.storage_path))
      );
      const result = await ocrDocument({
        pages,
        plugin,
        apiKey,
        model,
      });
      extracted = result.extracted;
      lineItems = result.lineItems ?? [];
      rawOcr = result.rawText;
      raw = result.raw;
    } else {
      const frontPath = imageRows.find((image) => image.role === "front")!.storage_path;
      const backPath = imageRows.find((image) => image.role === "back")?.storage_path;
      const result = await ocrDocument({
        front: await downloadImage(supabase, frontPath),
        back: backPath ? await downloadImage(supabase, backPath) : undefined,
        plugin,
        apiKey,
        model,
      });
      extracted = result.extracted;
      rawOcr = result.rawText;
      raw = result.raw;
    }
  } catch (err) {
    console.error("document OCR failed", err);
    extracted = plugin.parseExtracted({});
    warning = "ocr_failed";
  }

  const usage = extractTokenUsage("gemini", raw);
  const { data: run, error: runError } = await supabase
    .from("image_analysis_runs")
    .insert({
      tenant_id: tenant.tenantId,
      user_id: viewer.userId,
      capture_id: null,
      captured_document_id: row.id,
      provider: "gemini",
      estimated_cost_yen: estimateCostYen("gemini", raw),
      input_tokens: usage?.inputTokens ?? null,
      output_tokens: usage?.outputTokens ?? null,
    })
    .select("id")
    .maybeSingle();

  if (runError) {
    console.error("image_analysis_runs insert failed", runError);
  }

  return NextResponse.json({
    extracted,
    ...(lineItems !== undefined ? { lineItems } : {}),
    rawOcr,
    warning,
    analysisRunId: run?.id ?? null,
  });
}
