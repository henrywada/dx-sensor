import { describe, expect, it } from "vitest";
import { resolveDocumentPlugin } from "./resolvePlugin";
import { getDocumentPlugin } from "./registry";

describe("resolveDocumentPlugin", () => {
  it("returns the base plugin unchanged when it has no modes", () => {
    const resolved = resolveDocumentPlugin("invoice", null);
    expect(resolved).not.toBeNull();
    expect(resolved?.plugin).toBe(getDocumentPlugin("invoice"));
    expect(resolved?.documentMode).toBeNull();
  });

  it("ignores an arbitrary modeId for a plugin without modes", () => {
    const resolved = resolveDocumentPlugin("purchase_order", "bogus");
    expect(resolved).not.toBeNull();
    expect(resolved?.plugin).toBe(getDocumentPlugin("purchase_order"));
    expect(resolved?.documentMode).toBeNull();
  });

  it("returns null for an unregistered document type", () => {
    expect(resolveDocumentPlugin("unknown_type", null)).toBeNull();
  });

  it("resolves the expense mode functions for receipt", () => {
    const base = getDocumentPlugin("receipt");
    const resolved = resolveDocumentPlugin("receipt", "expense");
    expect(resolved).not.toBeNull();
    expect(resolved?.documentMode).toBe("expense");
    expect(resolved?.plugin.analyzePrompt).toBe(base?.modes?.[0].analyzePrompt);
    expect(resolved?.plugin.parseExtracted).toBe(base?.modes?.[0].parseExtracted);
    expect(resolved?.plugin.toIndexedFields).toBe(base?.modes?.[0].toIndexedFields);
    expect(resolved?.plugin.duplicateKeys).toBe(base?.modes?.[0].duplicateKeys);
    // 非モード固有のフィールドは基底プラグインのまま
    expect(resolved?.plugin.id).toBe("receipt");
    expect(resolved?.plugin.imagePolicy).toBe(base?.imagePolicy);
  });

  it("resolves the qualified_invoice mode functions for receipt", () => {
    const base = getDocumentPlugin("receipt");
    const resolved = resolveDocumentPlugin("receipt", "qualified_invoice");
    expect(resolved).not.toBeNull();
    expect(resolved?.documentMode).toBe("qualified_invoice");
    expect(resolved?.plugin.analyzePrompt).toBe(base?.modes?.[1].analyzePrompt);
  });

  it("returns null when receipt is requested without a valid modeId", () => {
    expect(resolveDocumentPlugin("receipt", null)).toBeNull();
    expect(resolveDocumentPlugin("receipt", "bogus")).toBeNull();
  });
});
