import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { canMutateDocument } from "@/lib/documents/canMutateDocument";
import { findDuplicate } from "@/lib/documents/findDuplicate";
import { lineItemDraftToDbRow } from "@/lib/documents/lineItems";
import type { LineItemDraft } from "@/lib/documents/pluginTypes";
import { getDocumentPlugin } from "@/lib/documents/registry";
import { BUCKET, finalObjectPath } from "@/lib/documents/storagePaths";
import { tokyoToday } from "@/lib/documents/tokyoDate";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseCommitBody, type ParsedCommitBody } from "./parseBody";

async function replaceLineItems(
  supabase: ReturnType<typeof createServerSupabase>,
  documentId: string,
  tenantId: string,
  drafts: LineItemDraft[]
) {
  await supabase.from("captured_document_line_items").delete().eq("document_id", documentId);
  if (drafts.length === 0) return;
  const rows = drafts.map((d) => lineItemDraftToDbRow(d, documentId, tenantId));
  const { error } = await supabase.from("captured_document_line_items").insert(rows);
  if (error) throw error;
}

type DocumentRow = {
  id: string;
  owner_user_id: string;
  company_visible: boolean;
  notes: string;
  tags: string[];
  context_date: string | null;
  extracted: Record<string, string>;
  raw_ocr: string;
  updated_at: string;
};

type ImageRow = {
  id: string;
  role: string;
  sort_order: number;
  storage_path: string;
};

type ListDocumentRow = {
  id: string;
  owner_user_id: string;
  document_type: string;
  document_mode: string | null;
  company_visible: boolean;
  title: string;
  counterparty: string;
  context_date: string | null;
  amount_yen: number | string | null;
  notes: string;
  tags: string[];
  extracted: unknown;
  created_at: string;
  updated_at: string;
};

const LIST_LIMIT = 50;
const ymdPattern = /^\d{4}-\d{2}-\d{2}$/;

function asExtracted(value: unknown): Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

function rowKeys(plugin: ParsedCommitBody["plugin"]) {
  return (row: DocumentRow) => plugin.duplicateKeys(row.extracted);
}

async function removePaths(
  supabase: ReturnType<typeof createServerSupabase>,
  paths: string[]
) {
  if (paths.length === 0) return;
  const { data, error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    console.error("captured document storage remove failed", { error, paths });
    return;
  }
  if ((data?.length ?? 0) < paths.length) {
    console.error("captured document storage remove missed objects", {
      requested: paths,
      removed: data?.map((object) => object.name) ?? [],
    });
  }
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

function parseOffset(value: string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseScope(value: string | null): "own" | "company" | "all" {
  if (value === "own" || value === "company" || value === "all") {
    return value;
  }
  return "all";
}

function parseSearch(value: string | null): string {
  return (value ?? "")
    .trim()
    .replace(/[,%*()]/g, " ")
    .replace(/\s+/g, " ");
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  return ymdPattern.test(value) ? value : null;
}

function parseAmountFilter(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildReplacementImages({
  tenantId,
  documentId,
  documentType,
  contextDate,
  parsed,
}: {
  tenantId: string;
  documentId: string;
  documentType: string;
  contextDate: string | null;
  parsed: ParsedCommitBody;
}) {
  const dateYmd = contextDate ?? tokyoToday();
  const imageRows: {
    document_id: string;
    tenant_id: string;
    sort_order: number;
    role: string;
    storage_path: string;
  }[] = [];
  const copyJobs: { tmpPath: string; destination: string }[] = [];

  for (const [index, image] of parsed.images.entries()) {
    const destination = finalObjectPath(
      tenantId,
      documentType,
      dateYmd,
      documentId,
      randomUUID()
    );
    imageRows.push({
      document_id: documentId,
      tenant_id: tenantId,
      sort_order: index,
      role: image.role,
      storage_path: destination,
    });
    copyJobs.push({ tmpPath: image.tmpPath, destination });
  }

  return { imageRows, copyJobs };
}

async function deleteImageRows(
  supabase: ReturnType<typeof createServerSupabase>,
  documentId: string,
  paths: string[]
) {
  if (paths.length === 0) return;
  const { error } = await supabase
    .from("captured_document_images")
    .delete()
    .eq("document_id", documentId)
    .in("storage_path", paths);
  if (error) {
    throw new Error(error.message);
  }
}

export async function GET(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return NextResponse.json({ error: "所属テナントが見つかりません" }, { status: 403 });
  }

  const url = new URL(req.url);
  const documentType = url.searchParams.get("type") || "business_card";
  const plugin = getDocumentPlugin(documentType);
  if (!plugin) {
    return NextResponse.json({ error: "文書種別が不正です" }, { status: 400 });
  }

  const mode = url.searchParams.get("mode");
  if (plugin.modes && plugin.modes.length > 0) {
    if (!mode || !plugin.modes.some((m) => m.id === mode)) {
      return NextResponse.json({ error: "区分（mode）の指定が不正です" }, { status: 400 });
    }
  }

  const scope = parseScope(url.searchParams.get("scope"));
  const offset = parseOffset(url.searchParams.get("offset"));
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  const q = parseSearch(url.searchParams.get("q"));
  const amountMin = parseAmountFilter(url.searchParams.get("amount_min"));
  const amountMax = parseAmountFilter(url.searchParams.get("amount_max"));
  const tags = url.searchParams
    .getAll("tag")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const supabase = createServerSupabase();
  let query = supabase
    .from("captured_documents")
    .select(
      "id, owner_user_id, document_type, document_mode, company_visible, title, counterparty, context_date, amount_yen, notes, tags, extracted, created_at, updated_at"
    )
    .eq("tenant_id", tenant.tenantId)
    .eq("document_type", plugin.id);

  if (mode) {
    query = query.eq("document_mode", mode);
  }

  if (scope === "own") {
    query = query.eq("owner_user_id", viewer.userId);
  } else if (scope === "company") {
    query = query.eq("company_visible", true);
  }

  for (const tag of tags) {
    query = query.contains("tags", [tag]);
  }
  if (from) query = query.gte("context_date", from);
  if (to) query = query.lte("context_date", to);
  if (amountMin !== null) query = query.gte("amount_yen", amountMin);
  if (amountMax !== null) query = query.lte("amount_yen", amountMax);
  if (q) {
    query = query.or(
      `title.ilike.*${q}*,counterparty.ilike.*${q}*,extracted->>email.ilike.*${q}*,extracted->>recipient_name.ilike.*${q}*,extracted->>issuer_name.ilike.*${q}*`
    );
  }

  const { data, error } = await query
    .order("context_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + LIST_LIMIT);

  if (error) {
    console.error("captured_documents list failed", error);
    return NextResponse.json({ error: "文書一覧の取得に失敗しました" }, { status: 500 });
  }

  const rows = (data ?? []) as ListDocumentRow[];
  const pageRows = rows.slice(0, LIST_LIMIT);
  const ids = pageRows.map((row) => row.id);
  const frontImages = new Map<string, string>();

  if (ids.length > 0) {
    const thumbnailRole = plugin.imagePolicy.allowedRoles.includes("page")
      ? "page"
      : "front";
    const { data: images, error: imageError } = await supabase
      .from("captured_document_images")
      .select("document_id, storage_path, sort_order")
      .in("document_id", ids)
      .eq("role", thumbnailRole)
      .order("sort_order", { ascending: true });

    if (imageError) {
      console.error("captured_document_images list failed", imageError);
      return NextResponse.json({ error: "文書画像の取得に失敗しました" }, { status: 500 });
    }

    for (const image of images ?? []) {
      if (!frontImages.has(image.document_id)) {
        frontImages.set(image.document_id, image.storage_path);
      }
    }
  }

  const documents = await Promise.all(
    pageRows.map(async (row) => ({
      id: row.id,
      documentType: row.document_type,
      documentMode: row.document_mode,
      ownerUserId: row.owner_user_id,
      companyVisible: row.company_visible,
      title: row.title,
      counterparty: row.counterparty,
      contextDate: row.context_date,
      amountYen: row.amount_yen,
      notes: row.notes,
      tags: row.tags ?? [],
      extracted: asExtracted(row.extracted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      frontImageUrl: frontImages.has(row.id)
        ? await signedUrl(supabase, frontImages.get(row.id)!)
        : null,
    }))
  );

  return NextResponse.json({
    documents,
    hasMore: rows.length > LIST_LIMIT,
    nextOffset: rows.length > LIST_LIMIT ? offset + LIST_LIMIT : null,
  });
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

  let parsed: ParsedCommitBody;
  try {
    parsed = parseCommitBody(await req.json(), {
      tenantId: tenant.tenantId,
      userId: viewer.userId,
    });
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const extracted = parsed.plugin.parseExtracted(parsed.extracted);

  let dupQuery = supabase
    .from("captured_documents")
    .select(
      "id, owner_user_id, company_visible, notes, tags, context_date, extracted, raw_ocr, updated_at"
    )
    .eq("tenant_id", tenant.tenantId)
    .eq("document_type", parsed.documentType);
  if (parsed.documentMode !== null) {
    dupQuery = dupQuery.eq("document_mode", parsed.documentMode);
  }
  const { data: rows, error: rowsError } = await dupQuery.or(
    `owner_user_id.eq.${viewer.userId},company_visible.eq.true`
  );

  if (rowsError) {
    console.error("captured_documents duplicate fetch failed", rowsError);
    return NextResponse.json({ error: "文書の確認に失敗しました" }, { status: 500 });
  }

  const visibleRows: DocumentRow[] = (rows ?? []).map((row) => ({
    id: row.id,
    owner_user_id: row.owner_user_id,
    company_visible: row.company_visible,
    notes: row.notes ?? "",
    tags: row.tags ?? [],
    context_date: row.context_date,
    extracted: asExtracted(row.extracted),
    raw_ocr: row.raw_ocr ?? "",
    updated_at: row.updated_at,
  }));

  let target = parsed.existingId
    ? visibleRows.find((row) => row.id === parsed.existingId) ?? null
    : null;
  if (parsed.existingId && !target) {
    return NextResponse.json({ error: "文書が見つかりません" }, { status: 404 });
  }

  if (
    target &&
    !canMutateDocument({
      actorUserId: viewer.userId,
      actorRole: tenant.role,
      isDeveloper: viewer.isDeveloper,
      ownerUserId: target.owner_user_id,
      companyVisible: target.company_visible,
    })
  ) {
    return NextResponse.json({ error: "文書を更新する権限がありません" }, { status: 403 });
  }

  const duplicate = findDuplicate(
    visibleRows,
    parsed.plugin.duplicateKeys(extracted),
    rowKeys(parsed.plugin),
    {
      exclude: (row) => row.id === parsed.existingId,
      updatedAt: (row) => row.updated_at,
    }
  );

  if (duplicate) {
    const canMutateDuplicate = canMutateDocument({
      actorUserId: viewer.userId,
      actorRole: tenant.role,
      isDeveloper: viewer.isDeveloper,
      ownerUserId: duplicate.owner_user_id,
      companyVisible: duplicate.company_visible,
    });
    if (!canMutateDuplicate) {
      return NextResponse.json(
        { error: "編集権限のない重複文書があります", duplicateId: duplicate.id },
        { status: 409 }
      );
    }
    target = duplicate;
  }

  let documentId = target?.id ?? null;
  let inserted = false;
  const oldImages: ImageRow[] = [];

  const nextNotes =
    target && !parsed.notesProvided ? target.notes : parsed.notes;
  const nextTags =
    target && !parsed.tagsProvided ? target.tags ?? [] : parsed.tags;
  const nextContextDate =
    target && !parsed.contextDateProvided
      ? target.context_date
      : parsed.contextDate;
  const nextCompanyVisible =
    target && !parsed.companyVisibleProvided
      ? target.company_visible
      : parsed.companyVisible;
  const nextRawOcr =
    target && !parsed.rawOcrProvided ? target.raw_ocr ?? "" : parsed.rawOcr;
  const nextIndexed = parsed.plugin.toIndexedFields(extracted, {
    notes: nextNotes,
    tags: nextTags,
    contextDate: nextContextDate,
  });
  const values = {
    company_visible: nextCompanyVisible,
    title: nextIndexed.title,
    counterparty: nextIndexed.counterparty,
    context_date: nextIndexed.context_date,
    amount_yen: nextIndexed.amount_yen,
    notes: nextNotes,
    tags: nextTags,
    extracted,
    raw_ocr: nextRawOcr,
    updated_at: new Date().toISOString(),
  };

  if (documentId) {
    const { data: existingImages, error: imageReadError } = await supabase
      .from("captured_document_images")
      .select("id, role, sort_order, storage_path")
      .eq("document_id", documentId);
    if (imageReadError) {
      console.error("captured_document_images fetch failed", imageReadError);
      return NextResponse.json({ error: "文書画像の確認に失敗しました" }, { status: 500 });
    }
    oldImages.push(...(existingImages ?? []));
  } else {
    const { data: insertedRow, error } = await supabase
      .from("captured_documents")
      .insert({
        ...values,
        tenant_id: tenant.tenantId,
        owner_user_id: viewer.userId,
        document_type: parsed.documentType,
        document_mode: parsed.documentMode,
      })
      .select("id")
      .maybeSingle();
    if (error || !insertedRow) {
      console.error("captured_documents insert failed", error);
      return NextResponse.json({ error: "文書の保存に失敗しました" }, { status: 500 });
    }
    documentId = insertedRow.id;
    inserted = true;
  }
  if (!documentId) {
    return NextResponse.json({ error: "文書の保存に失敗しました" }, { status: 500 });
  }
  const savedDocumentId = documentId;

  let copiedPaths: string[] = [];
  let newImageRowsInserted = false;
  let newImageRowPaths: string[] = [];
  try {
    const replacement = buildReplacementImages({
      tenantId: tenant.tenantId,
      documentId: savedDocumentId,
      documentType: parsed.documentType,
      contextDate: nextContextDate,
      parsed,
    });
    newImageRowPaths = replacement.imageRows.map((image) => image.storage_path);

    const { error: imageInsertError } = await supabase
      .from("captured_document_images")
      .insert(replacement.imageRows);
    if (imageInsertError) {
      throw new Error(imageInsertError.message);
    }
    newImageRowsInserted = true;

    for (const job of replacement.copyJobs) {
      const { error } = await supabase.storage
        .from(BUCKET)
        .copy(job.tmpPath, job.destination);
      if (error) {
        throw new Error(error.message);
      }
      copiedPaths.push(job.destination);
    }

    if (!inserted) {
      const { error } = await supabase
        .from("captured_documents")
        .update(values)
        .eq("id", savedDocumentId)
        .eq("tenant_id", tenant.tenantId);
      if (error) {
        throw new Error(error.message);
      }
    }

    if (parsed.plugin.supportsLineItems) {
      await replaceLineItems(supabase, savedDocumentId, tenant.tenantId, parsed.lineItems);
    }
  } catch (err) {
    console.error("captured document image replace failed", err);
    await removePaths(supabase, copiedPaths);
    if (newImageRowsInserted) {
      try {
        await deleteImageRows(supabase, savedDocumentId, newImageRowPaths);
      } catch (deleteErr) {
        console.error("new captured_document_images cleanup failed", deleteErr);
      }
    }
    if (inserted) {
      await supabase.from("captured_documents").delete().eq("id", savedDocumentId);
    }
    return NextResponse.json({ error: "文書画像の保存に失敗しました" }, { status: 500 });
  }

  if (!inserted && oldImages.length > 0) {
    const oldPaths = oldImages.map((image) => image.storage_path);
    await removePaths(supabase, oldPaths);
    try {
      await deleteImageRows(supabase, savedDocumentId, oldPaths);
    } catch (err) {
      console.error("old captured_document_images cleanup failed", err);
    }
  }

  await removePaths(
    supabase,
    parsed.images.map((image) => image.tmpPath)
  );

  if (parsed.analysisRunId) {
    const { error } = await supabase
      .from("image_analysis_runs")
      .update({ captured_document_id: savedDocumentId })
      .eq("id", parsed.analysisRunId)
      .eq("tenant_id", tenant.tenantId)
      .eq("user_id", viewer.userId);
    if (error) {
      console.error("image_analysis_runs document link failed", error);
    }
  }

  return NextResponse.json({ id: savedDocumentId, updated: !inserted });
}
