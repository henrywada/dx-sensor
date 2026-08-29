import type { DocumentTypePlugin } from "./pluginTypes";
import { businessCardPlugin } from "./types/business_card/plugin";
import { invoicePlugin } from "./types/invoice/plugin";
import { purchaseOrderPlugin } from "./types/purchase_order/plugin";

const plugins: Record<string, DocumentTypePlugin> = {
  business_card: businessCardPlugin,
  invoice: invoicePlugin,
  purchase_order: purchaseOrderPlugin,
};

export function getDocumentPlugin(id: string): DocumentTypePlugin | null {
  return plugins[id] ?? null;
}
