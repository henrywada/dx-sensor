import { describe, expect, it } from "vitest";
import { EXPORTABLE_TYPES, exportFilenameTimestamp, parseExportBody } from "./route";

describe("EXPORTABLE_TYPES", () => {
  it("allows invoice and purchase_order", () => {
    expect(EXPORTABLE_TYPES.has("invoice")).toBe(true);
    expect(EXPORTABLE_TYPES.has("purchase_order")).toBe(true);
  });

  it("does not allow business_card (contains personal information)", () => {
    expect(EXPORTABLE_TYPES.has("business_card")).toBe(false);
  });
});

describe("parseExportBody", () => {
  it("parses a valid invoice export request", () => {
    const parsed = parseExportBody({
      documentType: "invoice",
      documentIds: ["a", "b"],
      exportMode: "with_line_items",
    });
    expect(parsed).toEqual({
      documentType: "invoice",
      documentIds: ["a", "b"],
      exportMode: "with_line_items",
    });
  });

  it("parses a valid purchase_order export request", () => {
    const parsed = parseExportBody({
      documentType: "purchase_order",
      documentIds: ["a"],
    });
    expect(parsed).toEqual({
      documentType: "purchase_order",
      documentIds: ["a"],
      exportMode: "summary",
    });
  });

  it("defaults exportMode to summary for unknown values", () => {
    const parsed = parseExportBody({
      documentType: "invoice",
      documentIds: ["a"],
      exportMode: "unknown",
    });
    expect(parsed?.exportMode).toBe("summary");
  });

  it("rejects business_card even though it is a registered document type elsewhere", () => {
    expect(
      parseExportBody({ documentType: "business_card", documentIds: ["a"] })
    ).toBeNull();
  });

  it("rejects unregistered document types", () => {
    expect(
      parseExportBody({ documentType: "unknown_type", documentIds: ["a"] })
    ).toBeNull();
  });

  it("rejects non-string documentType", () => {
    expect(parseExportBody({ documentType: null, documentIds: ["a"] })).toBeNull();
    expect(parseExportBody({ documentType: 123, documentIds: ["a"] })).toBeNull();
    expect(parseExportBody({ documentType: ["invoice"], documentIds: ["a"] })).toBeNull();
    expect(parseExportBody({ documentType: "", documentIds: ["a"] })).toBeNull();
  });

  it("rejects empty or non-array documentIds", () => {
    expect(parseExportBody({ documentType: "invoice", documentIds: [] })).toBeNull();
    expect(
      parseExportBody({ documentType: "invoice", documentIds: "a" })
    ).toBeNull();
    expect(parseExportBody({ documentType: "invoice" })).toBeNull();
  });

  it("rejects more than 100 documentIds", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect(parseExportBody({ documentType: "invoice", documentIds: ids })).toBeNull();
  });

  it("accepts exactly 100 documentIds", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    expect(parseExportBody({ documentType: "invoice", documentIds: ids })).not.toBeNull();
  });

  it("rejects documentIds containing non-string or empty values", () => {
    expect(
      parseExportBody({ documentType: "invoice", documentIds: ["a", 1] })
    ).toBeNull();
    expect(
      parseExportBody({ documentType: "invoice", documentIds: ["a", ""] })
    ).toBeNull();
  });

  it("rejects non-object body", () => {
    expect(parseExportBody(null)).toBeNull();
    expect(parseExportBody("string")).toBeNull();
    expect(parseExportBody([])).toBeNull();
  });
});

describe("exportFilenameTimestamp", () => {
  it("formats as YYYYMMDD_HHmmss in Asia/Tokyo time", () => {
    const fixed = new Date("2024-01-31T15:04:05Z"); // UTC -> JST 2024-02-01 00:04:05
    expect(exportFilenameTimestamp(fixed)).toBe("20240201_000405");
  });
});
