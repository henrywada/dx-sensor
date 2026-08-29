import type {
  DocumentTypePlugin,
  ImageRole,
  LineItemDraft,
} from "@/lib/documents/pluginTypes";
import { resolveDocumentPlugin } from "@/lib/documents/resolvePlugin";
import { isTmpPath } from "@/lib/documents/storagePaths";

type ParseContext = {
  tenantId: string;
  userId: string;
};

export type ParsedAnalyzeImage = {
  role: ImageRole;
  path: string;
};

export type ParsedAnalyzeBody = {
  documentType: string;
  documentMode: string | null;
  plugin: DocumentTypePlugin;
  images: ParsedAnalyzeImage[];
};

export type ParsedCommitImage = {
  role: ImageRole;
  tmpPath: string;
};

export type ParsedCommitBody = {
  documentType: string;
  documentMode: string | null;
  plugin: DocumentTypePlugin;
  existingId: string | null;
  companyVisible: boolean;
  companyVisibleProvided: boolean;
  notes: string;
  notesProvided: boolean;
  tags: string[];
  tagsProvided: boolean;
  contextDate: string | null;
  contextDateProvided: boolean;
  extracted: Record<string, unknown>;
  rawOcr: string;
  rawOcrProvided: boolean;
  analysisRunId: string | null;
  images: ParsedCommitImage[];
  lineItems: LineItemDraft[];
};

const imageRoles = new Set<ImageRole>(["front", "back", "page"]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ymdPattern = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlugin(body: Record<string, unknown>): {
  documentType: string;
  documentMode: string | null;
  plugin: DocumentTypePlugin;
} {
  const documentType = body.documentType;
  if (typeof documentType !== "string") {
    throw new Error("documentType is required");
  }

  const rawMode = body.documentMode;
  if (rawMode !== undefined && rawMode !== null && typeof rawMode !== "string") {
    throw new Error("invalid documentMode");
  }
  const modeId = typeof rawMode === "string" ? rawMode : null;

  const resolved = resolveDocumentPlugin(documentType, modeId);
  if (!resolved) {
    throw new Error("unknown document type or mode");
  }

  return { documentType, documentMode: resolved.documentMode, plugin: resolved.plugin };
}

function parseRole(value: unknown, plugin: DocumentTypePlugin): ImageRole {
  if (typeof value !== "string" || !imageRoles.has(value as ImageRole)) {
    throw new Error("invalid image role");
  }

  const role = value as ImageRole;
  if (!plugin.imagePolicy.allowedRoles.includes(role)) {
    throw new Error("image role is not allowed for document type");
  }
  return role;
}

function validateImages<T extends { role: ImageRole }>(
  images: T[],
  plugin: DocumentTypePlugin
): T[] {
  if (
    images.length < plugin.imagePolicy.min ||
    images.length > plugin.imagePolicy.max
  ) {
    throw new Error("invalid image count");
  }

  const allowed = new Set(plugin.imagePolicy.allowedRoles);
  if (!images.every((image) => allowed.has(image.role))) {
    throw new Error("invalid image role for document type");
  }

  return images;
}

export function parseLineItemsBody(
  body: Record<string, unknown>,
  plugin: DocumentTypePlugin
): LineItemDraft[] {
  if (!plugin.supportsLineItems) {
    return [];
  }

  if (!Object.prototype.hasOwnProperty.call(body, "lineItems")) {
    throw new Error("lineItems is required");
  }

  if (!plugin.parseLineItems) {
    throw new Error("lineItems parser is not configured");
  }

  return plugin.parseLineItems(body.lineItems);
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function parseOptionalUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error("invalid uuid");
  }
  return value;
}

function parseContextDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !ymdPattern.test(value)) {
    throw new Error("invalid contextDate");
  }
  return value;
}

export function parseAnalyzeBody(
  body: unknown,
  context: ParseContext
): ParsedAnalyzeBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { documentType, documentMode, plugin } = parsePlugin(body);
  if (!Array.isArray(body.images)) throw new Error("images are required");

  const images = body.images.map((image) => {
    if (!isRecord(image)) throw new Error("invalid image");
    const role = parseRole(image.role, plugin);
    if (
      typeof image.path !== "string" ||
      !isTmpPath(image.path, context.tenantId, context.userId)
    ) {
      throw new Error("invalid tmp path");
    }
    return { role, path: image.path };
  });

  return {
    documentType,
    documentMode,
    plugin,
    images: validateImages(images, plugin),
  };
}

export function parseCommitBody(
  body: unknown,
  context: ParseContext
): ParsedCommitBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { documentType, documentMode, plugin } = parsePlugin(body);
  if (!Array.isArray(body.images)) throw new Error("images are required");

  const images = body.images.map((image) => {
    if (!isRecord(image)) throw new Error("invalid image");
    const role = parseRole(image.role, plugin);
    if (
      typeof image.tmpPath !== "string" ||
      !isTmpPath(image.tmpPath, context.tenantId, context.userId)
    ) {
      throw new Error("invalid tmp path");
    }
    return { role, tmpPath: image.tmpPath };
  });

  return {
    documentType,
    documentMode,
    plugin,
    existingId: parseOptionalUuid(body.existingId),
    companyVisible: body.companyVisible === true,
    companyVisibleProvided: Object.prototype.hasOwnProperty.call(body, "companyVisible"),
    notes: typeof body.notes === "string" ? body.notes.trim() : "",
    notesProvided: Object.prototype.hasOwnProperty.call(body, "notes"),
    tags: parseTags(body.tags),
    tagsProvided: Object.prototype.hasOwnProperty.call(body, "tags"),
    contextDate: parseContextDate(body.contextDate),
    contextDateProvided: Object.prototype.hasOwnProperty.call(body, "contextDate"),
    extracted: isRecord(body.extracted) ? body.extracted : {},
    rawOcr: typeof body.rawOcr === "string" ? body.rawOcr : "",
    rawOcrProvided: Object.prototype.hasOwnProperty.call(body, "rawOcr"),
    analysisRunId: parseOptionalUuid(body.analysisRunId),
    images: validateImages(images, plugin),
    lineItems: parseLineItemsBody(body, plugin),
  };
}
