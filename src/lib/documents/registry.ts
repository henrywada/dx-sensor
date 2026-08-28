import type { DocumentTypePlugin } from "./pluginTypes";
import { businessCardPlugin } from "./types/business_card/plugin";

const plugins: Record<string, DocumentTypePlugin> = {
  business_card: businessCardPlugin,
};

export function getDocumentPlugin(id: string): DocumentTypePlugin | null {
  return plugins[id] ?? null;
}
