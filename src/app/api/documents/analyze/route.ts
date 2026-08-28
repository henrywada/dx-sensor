import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { canMutateDocument } from "@/lib/documents/canMutateDocument";
import { cleanupTmp } from "@/lib/documents/cleanupTmp";
import { findDuplicate } from "@/lib/documents/findDuplicate";
import type { LineItemDraft } from "@/lib/documents/pluginTypes";
import { BUCKET } from "@/lib/documents/storagePaths";
import { estimateCostYen, extractTokenUsage } from "@/lib/image-analysis/estimateCostYen";
import {
  type DocumentOcrImage,
  ocrDocument,
} from "@/lib/image-analysis/document-ocr/documentOcr";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseAnalyzeBody } from "../parseBody";

type VisibleDocumentRow = {
  id: string;
  owner_user_id: string;
  company_visible: boolean;
  notes: string;
  tags: string[];
  context_date: string | null;
  extracted: Record<string, string>;
  updated_at: string;
};

function asExtracted(value: unknown): Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

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

async function signedUrl(
  supabase: ReturnType<typeof createServerSupabase>,
  path: string
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error) {
    console.error("captured document signed URL failed", error);
    return null;
  }
  return data?.signedUrl ?? null;
}

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
    parsed = parseAnalyzeBody(await req.json(), {
      tenantId: tenant.tenantId,
      userId: viewer.userId,
    });
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  await cleanupTmp(supabase, tenant.tenantId, viewer.userId);

  if (!parsed.plugin.structuredOcr) {
    const frontPath = parsed.images.find((image) => image.role === "front")?.path;
    if (!frontPath) {
      return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
    }
  }

  let extracted: Record<string, string>;
  let lineItems: LineItemDraft[] | undefined;
  let rawOcr = "";
  let raw: unknown = null;
  let warning: "ocr_failed" | undefined;

  if (parsed.plugin.structuredOcr) {
    lineItems = [];
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY が未設定です");
    }

    const model = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

    if (parsed.plugin.structuredOcr) {
      const pages = await Promise.all(
        parsed.images.map((image) => downloadImage(supabase, image.path))
      );
      const result = await ocrDocument({
        pages,
        plugin: parsed.plugin,
        apiKey,
        model,
      });
      extracted = result.extracted;
      lineItems = result.lineItems ?? [];
      rawOcr = result.rawText;
      raw = result.raw;
    } else {
      const frontPath = parsed.images.find((image) => image.role === "front")!.path;
      const backPath = parsed.images.find((image) => image.role === "back")?.path;
      const result = await ocrDocument({
        front: await downloadImage(supabase, frontPath),
        back: backPath ? await downloadImage(supabase, backPath) : undefined,
        plugin: parsed.plugin,
        apiKey,
        model,
      });
      extracted = result.extracted;
      rawOcr = result.rawText;
      raw = result.raw;
    }
  } catch (err) {
    console.error("document OCR failed", err);
    extracted = parsed.plugin.parseExtracted({});
    warning = "ocr_failed";
  }

  const usage = extractTokenUsage("gemini", raw);
  const { data: run, error: runError } = await supabase
    .from("image_analysis_runs")
    .insert({
      tenant_id: tenant.tenantId,
      user_id: viewer.userId,
      capture_id: null,
      captured_document_id: null,
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

  const { data: rows, error: rowsError } = await supabase
    .from("captured_documents")
    .select(
      "id, owner_user_id, company_visible, notes, tags, context_date, extracted, updated_at"
    )
    .eq("tenant_id", tenant.tenantId)
    .eq("document_type", parsed.documentType)
    .or(`owner_user_id.eq.${viewer.userId},company_visible.eq.true`);

  if (rowsError) {
    console.error("captured_documents duplicate fetch failed", rowsError);
  }

  const visibleRows: VisibleDocumentRow[] = (rows ?? []).map((row) => ({
    id: row.id,
    owner_user_id: row.owner_user_id,
    company_visible: row.company_visible,
    notes: row.notes ?? "",
    tags: row.tags ?? [],
    context_date: row.context_date,
    extracted: asExtracted(row.extracted),
    updated_at: row.updated_at,
  }));
  const duplicate = findDuplicate(
    visibleRows,
    parsed.plugin.duplicateKeys(extracted),
    (row) => parsed.plugin.duplicateKeys(row.extracted),
    { updatedAt: (row) => row.updated_at }
  );

  let duplicatePayload = null;
  if (duplicate) {
    const { data: images } = await supabase
      .from("captured_document_images")
      .select("role, storage_path, sort_order")
      .eq("document_id", duplicate.id)
      .order("sort_order", { ascending: true });

    duplicatePayload = {
      id: duplicate.id,
      canMutate: canMutateDocument({
        actorUserId: viewer.userId,
        actorRole: tenant.role,
        isDeveloper: viewer.isDeveloper,
        ownerUserId: duplicate.owner_user_id,
        companyVisible: duplicate.company_visible,
      }),
      extracted: duplicate.extracted,
      notes: duplicate.notes,
      tags: duplicate.tags,
      contextDate: duplicate.context_date,
      companyVisible: duplicate.company_visible,
      images: await Promise.all(
        (images ?? []).map(async (image) => ({
          role: image.role,
          url: await signedUrl(supabase, image.storage_path),
        }))
      ),
    };
  }

  return NextResponse.json({
    extracted,
    ...(lineItems !== undefined ? { lineItems } : {}),
    rawOcr,
    warning,
    analysisRunId: run?.id ?? null,
    duplicate: duplicatePayload,
  });
}
