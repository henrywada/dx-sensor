import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { canMutateDocument } from "@/lib/documents/canMutateDocument";
import { findDuplicate } from "@/lib/documents/findDuplicate";
import { getDocumentPlugin } from "@/lib/documents/registry";
import { BUCKET } from "@/lib/documents/storagePaths";
import { createServerSupabase } from "@/lib/supabase/server";

type RouteContext = {
  params: { id: string };
};

type DocumentRow = {
  id: string;
  owner_user_id: string;
  document_type: string;
  company_visible: boolean;
  title: string;
  counterparty: string;
  context_date: string | null;
  amount_yen: number | string | null;
  notes: string;
  tags: string[];
  extracted: unknown;
  raw_ocr: string;
  created_at: string;
  updated_at: string;
};

type DuplicateRow = {
  id: string;
  owner_user_id: string;
  company_visible: boolean;
  extracted: Record<string, string>;
  updated_at: string;
};

type ImageRow = {
  id: string;
  role: string;
  sort_order: number;
  storage_path: string;
};

type PatchBody = {
  companyVisible?: boolean;
  notes?: string;
  tags?: string[];
  contextDate?: string | null;
  extracted?: Record<string, string>;
};

type PreparedRequest = {
  viewer: { userId: string; isDeveloper: boolean };
  tenant: { tenantId: string; role: "owner" | "admin" | "viewer" | "developer" };
  supabase: ReturnType<typeof createServerSupabase>;
  row: DocumentRow;
  images: ImageRow[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ymdPattern = /^\d{4}-\d{2}-\d{2}$/;

function asExtracted(value: unknown): Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("invalid tags");
  return Array.from(
    new Set(
      value
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function parseContextDate(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !ymdPattern.test(value)) {
    throw new Error("invalid contextDate");
  }
  return value;
}

function parsePatchBody(body: unknown): PatchBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const parsed: PatchBody = {};
  if (hasOwn(body, "companyVisible")) {
    if (typeof body.companyVisible !== "boolean") {
      throw new Error("invalid companyVisible");
    }
    parsed.companyVisible = body.companyVisible;
  }
  if (hasOwn(body, "notes")) {
    if (typeof body.notes !== "string") throw new Error("invalid notes");
    parsed.notes = body.notes.trim();
  }
  if (hasOwn(body, "tags")) {
    parsed.tags = parseTags(body.tags);
  }
  if (hasOwn(body, "contextDate")) {
    parsed.contextDate = parseContextDate(body.contextDate);
  }
  if (hasOwn(body, "extracted")) {
    if (!isRecord(body.extracted)) throw new Error("invalid extracted");
    parsed.extracted = Object.fromEntries(
      Object.entries(body.extracted).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string"
      )
    );
  }

  return parsed;
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

async function removePathsStrict(
  supabase: ReturnType<typeof createServerSupabase>,
  paths: string[]
): Promise<boolean> {
  if (paths.length === 0) return true;
  const { data, error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    console.error("captured document storage remove failed", { error, paths });
    return false;
  }
  if ((data?.length ?? 0) < paths.length) {
    console.error("captured document storage remove missed objects", {
      requested: paths,
      removed: data?.map((object) => object.name) ?? [],
    });
    return false;
  }
  return true;
}

function canMutate(
  row: DocumentRow,
  viewer: { userId: string; isDeveloper: boolean },
  role: "owner" | "admin" | "viewer" | "developer"
) {
  return canMutateDocument({
    actorUserId: viewer.userId,
    actorRole: role,
    isDeveloper: viewer.isDeveloper,
    ownerUserId: row.owner_user_id,
    companyVisible: row.company_visible,
  });
}

async function loadDocument(
  supabase: ReturnType<typeof createServerSupabase>,
  tenantId: string,
  id: string
): Promise<{ row: DocumentRow | null; images: ImageRow[]; error: unknown }> {
  const { data: row, error } = await supabase
    .from("captured_documents")
    .select(
      "id, owner_user_id, document_type, company_visible, title, counterparty, context_date, amount_yen, notes, tags, extracted, raw_ocr, created_at, updated_at"
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !row) {
    return { row: null, images: [], error };
  }

  const { data: images, error: imageError } = await supabase
    .from("captured_document_images")
    .select("id, role, sort_order, storage_path")
    .eq("document_id", id)
    .order("sort_order", { ascending: true });

  return {
    row: row as DocumentRow,
    images: (images ?? []) as ImageRow[],
    error: imageError,
  };
}

async function serializeDocument(
  supabase: ReturnType<typeof createServerSupabase>,
  row: DocumentRow,
  images: ImageRow[],
  canMutateCurrent: boolean
) {
  return {
    id: row.id,
    documentType: row.document_type,
    ownerUserId: row.owner_user_id,
    companyVisible: row.company_visible,
    title: row.title,
    counterparty: row.counterparty,
    contextDate: row.context_date,
    amountYen: row.amount_yen,
    notes: row.notes,
    tags: row.tags ?? [],
    extracted: asExtracted(row.extracted),
    rawOcr: row.raw_ocr,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canMutate: canMutateCurrent,
    images: await Promise.all(
      images.map(async (image) => ({
        id: image.id,
        role: image.role,
        sortOrder: image.sort_order,
        storagePath: image.storage_path,
        url: await signedUrl(supabase, image.storage_path),
      }))
    ),
  };
}

async function prepareRequest(
  id: string
): Promise<PreparedRequest | { response: NextResponse }> {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return {
      response: NextResponse.json({ error: "ログインが必要です" }, { status: 401 }),
    };
  }

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return {
      response: NextResponse.json(
        { error: "所属テナントが見つかりません" },
        { status: 403 }
      ),
    };
  }

  if (!uuidPattern.test(id)) {
    return {
      response: NextResponse.json({ error: "文書が見つかりません" }, { status: 404 }),
    };
  }

  const supabase = createServerSupabase();
  const loaded = await loadDocument(supabase, tenant.tenantId, id);
  if (loaded.error) {
    console.error("captured document fetch failed", loaded.error);
    return {
      response: NextResponse.json(
        { error: "文書の取得に失敗しました" },
        { status: 500 }
      ),
    };
  }
  if (!loaded.row) {
    return {
      response: NextResponse.json({ error: "文書が見つかりません" }, { status: 404 }),
    };
  }

  return {
    viewer: { userId: viewer.userId, isDeveloper: viewer.isDeveloper },
    tenant,
    supabase,
    row: loaded.row,
    images: loaded.images,
  };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const prepared = await prepareRequest(params.id);
  if ("response" in prepared) return prepared.response;

  const canMutateCurrent = canMutate(
    prepared.row,
    prepared.viewer,
    prepared.tenant.role
  );
  return NextResponse.json({
    document: await serializeDocument(
      prepared.supabase,
      prepared.row,
      prepared.images,
      canMutateCurrent
    ),
  });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const prepared = await prepareRequest(params.id);
  if ("response" in prepared) return prepared.response;

  if (!canMutate(prepared.row, prepared.viewer, prepared.tenant.role)) {
    return NextResponse.json({ error: "文書を更新する権限がありません" }, { status: 403 });
  }

  const plugin = getDocumentPlugin(prepared.row.document_type);
  if (!plugin) {
    return NextResponse.json({ error: "文書種別が不正です" }, { status: 400 });
  }

  let patch: PatchBody;
  try {
    patch = parsePatchBody(await req.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const nextExtracted = patch.extracted
    ? plugin.parseExtracted(patch.extracted)
    : plugin.parseExtracted(asExtracted(prepared.row.extracted));
  const nextNotes = patch.notes ?? prepared.row.notes;
  const nextTags = patch.tags ?? prepared.row.tags ?? [];
  const nextContextDate =
    patch.contextDate !== undefined ? patch.contextDate : prepared.row.context_date;
  const nextCompanyVisible =
    patch.companyVisible ?? prepared.row.company_visible;

  if (!prepared.row.company_visible && nextCompanyVisible) {
    const { data: rows, error } = await prepared.supabase
      .from("captured_documents")
      .select("id, owner_user_id, company_visible, extracted, updated_at")
      .eq("tenant_id", prepared.tenant.tenantId)
      .eq("document_type", plugin.id)
      .or(`owner_user_id.eq.${prepared.viewer.userId},company_visible.eq.true`);

    if (error) {
      console.error("captured_documents duplicate fetch failed", error);
      return NextResponse.json({ error: "文書の確認に失敗しました" }, { status: 500 });
    }

    const visibleRows: DuplicateRow[] = (rows ?? []).map((row) => ({
      id: row.id,
      owner_user_id: row.owner_user_id,
      company_visible: row.company_visible,
      extracted: asExtracted(row.extracted),
      updated_at: row.updated_at,
    }));
    const duplicate = findDuplicate(
      visibleRows,
      plugin.duplicateKeys(nextExtracted),
      (row) => plugin.duplicateKeys(row.extracted),
      {
        exclude: (row) => row.id === prepared.row.id,
        include: (row) => row.company_visible,
        updatedAt: (row) => row.updated_at,
      }
    );

    if (duplicate) {
      return NextResponse.json(
        { error: "会社公開済みの重複文書があります", duplicateId: duplicate.id },
        { status: 409 }
      );
    }
  }

  const indexed = plugin.toIndexedFields(nextExtracted, {
    notes: nextNotes,
    tags: nextTags,
    contextDate: nextContextDate,
  });

  const { data: updated, error } = await prepared.supabase
    .from("captured_documents")
    .update({
      company_visible: nextCompanyVisible,
      title: indexed.title,
      counterparty: indexed.counterparty,
      context_date: indexed.context_date,
      amount_yen: indexed.amount_yen,
      notes: nextNotes,
      tags: nextTags,
      extracted: nextExtracted,
      updated_at: new Date().toISOString(),
    })
    .eq("id", prepared.row.id)
    .eq("tenant_id", prepared.tenant.tenantId)
    .select(
      "id, owner_user_id, document_type, company_visible, title, counterparty, context_date, amount_yen, notes, tags, extracted, raw_ocr, created_at, updated_at"
    )
    .maybeSingle();

  if (error || !updated) {
    console.error("captured document update failed", error);
    return NextResponse.json({ error: "文書の更新に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({
    document: await serializeDocument(
      prepared.supabase,
      updated as DocumentRow,
      prepared.images,
      true
    ),
  });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const prepared = await prepareRequest(params.id);
  if ("response" in prepared) return prepared.response;

  if (!canMutate(prepared.row, prepared.viewer, prepared.tenant.role)) {
    return NextResponse.json({ error: "文書を削除する権限がありません" }, { status: 403 });
  }

  const paths = prepared.images.map((image) => image.storage_path);
  const removed = await removePathsStrict(prepared.supabase, paths);
  if (!removed) {
    return NextResponse.json({ error: "文書画像の削除に失敗しました" }, { status: 500 });
  }

  const { error } = await prepared.supabase
    .from("captured_documents")
    .delete()
    .eq("id", prepared.row.id)
    .eq("tenant_id", prepared.tenant.tenantId);

  if (error) {
    console.error("captured document delete failed", error);
    return NextResponse.json({ error: "文書の削除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ id: prepared.row.id, deleted: true });
}
