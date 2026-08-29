import type { DocumentTypePlugin } from "./pluginTypes";
import { getDocumentPlugin } from "./registry";

export interface ResolvedDocumentPlugin {
  plugin: DocumentTypePlugin;
  documentMode: string | null;
}

export function resolveDocumentPlugin(
  documentType: string,
  modeId: string | null
): ResolvedDocumentPlugin | null {
  const base = getDocumentPlugin(documentType);
  if (!base) {
    return null;
  }

  if (!base.modes || base.modes.length === 0) {
    return { plugin: base, documentMode: null };
  }

  const mode = base.modes.find((m) => m.id === modeId);
  if (!mode) {
    return null;
  }

  return {
    plugin: {
      ...base,
      analyzePrompt: mode.analyzePrompt,
      parseExtracted: mode.parseExtracted,
      toIndexedFields: mode.toIndexedFields,
      duplicateKeys: mode.duplicateKeys,
    },
    documentMode: mode.id,
  };
}
