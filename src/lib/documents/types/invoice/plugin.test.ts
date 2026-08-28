import { describe, expect, it } from "vitest";
import { getDocumentPlugin } from "../../registry";
import {
  INVOICE_HEADER_KEYS,
  invoicePlugin,
  normalizeInvoiceNoIssuer,
  parseAmountYen,
  parseInvoiceHeader,
  parseLineItems,
} from "./plugin";

describe("invoicePlugin", () => {
  it("maps header to indexed fields", () => {
    const extracted = Object.fromEntries(
      INVOICE_HEADER_KEYS.map((k) => [k, ""])
    ) as Record<string, string>;
    extracted.invoice_number = "20240131-001";
    extracted.issuer_name = "サンプル株式会社";
    extracted.total = "360,000";
    const indexed = invoicePlugin.toIndexedFields(extracted, {
      notes: "",
      tags: [],
      contextDate: "2024-01-31",
    });
    expect(indexed.title).toBe("20240131-001");
    expect(indexed.counterparty).toBe("サンプル株式会社");
    expect(indexed.amount_yen).toBe(360000);
    expect(indexed.context_date).toBe("2024-01-31");
  });

  it("parses line items from array", () => {
    const items = parseLineItems([
      { line_no: 1, description: "サンプルA", amount: "20000", tax_rate: "10" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("サンプルA");
    expect(items[0].tax_rate).toBe("10");
  });

  it("builds duplicate key from invoice number and issuer", () => {
    const keys = invoicePlugin.duplicateKeys({
      invoice_number: " 123 ",
      issuer_name: "Sample Co.",
    });
    expect(keys[0].kind).toBe("invoice_no_issuer");
    expect(keys[0].value).toContain("123");
    expect(keys[0].value).toContain("sample co.");
  });

  it("exposes line item and structured OCR flags", () => {
    expect(invoicePlugin.supportsLineItems).toBe(true);
    expect(invoicePlugin.structuredOcr).toBe(true);
    expect(invoicePlugin.parseLineItems).toBe(parseLineItems);
  });

  it("allows 1-10 page images only", () => {
    expect(invoicePlugin.imagePolicy).toEqual({
      min: 1,
      max: 10,
      allowedRoles: ["page"],
    });
  });

  it("uses user contextDate for indexed context_date", () => {
    const extracted = Object.fromEntries(
      INVOICE_HEADER_KEYS.map((k) => [k, ""])
    ) as Record<string, string>;
    extracted.issue_date = "2024-01-31";
    const indexed = invoicePlugin.toIndexedFields(extracted, {
      notes: "",
      tags: [],
      contextDate: null,
    });
    expect(indexed.context_date).toBeNull();
  });

  it("returns null amount_yen when total is unparseable", () => {
    const extracted = Object.fromEntries(
      INVOICE_HEADER_KEYS.map((k) => [k, ""])
    ) as Record<string, string>;
    extracted.total = "invalid";
    const indexed = invoicePlugin.toIndexedFields(extracted, {
      notes: "",
      tags: [],
      contextDate: null,
    });
    expect(indexed.amount_yen).toBeNull();
  });
});

describe("parseInvoiceHeader", () => {
  it("parses from structured header object", () => {
    const parsed = parseInvoiceHeader({
      header: {
        invoice_number: "INV-001",
        issuer_name: "テスト株式会社",
      },
    });
    expect(parsed.invoice_number).toBe("INV-001");
    expect(parsed.issuer_name).toBe("テスト株式会社");
    expect(parsed.recipient_name).toBe("");
  });

  it("parses from flat object", () => {
    const parsed = parseInvoiceHeader({
      invoice_number: "INV-002",
      total: "1000",
      extra: "ignored",
    });
    expect(parsed.invoice_number).toBe("INV-002");
    expect(parsed.total).toBe("1000");
    expect(parsed).not.toHaveProperty("extra");
  });

  it("returns empty header for invalid input", () => {
    const parsed = parseInvoiceHeader(null);
    expect(parsed.invoice_number).toBe("");
    expect(Object.keys(parsed)).toHaveLength(INVOICE_HEADER_KEYS.length);
  });
});

describe("invoicePlugin.parseExtracted", () => {
  it("delegates to parseInvoiceHeader", () => {
    const parsed = invoicePlugin.parseExtracted({
      header: { invoice_number: "X-1" },
    });
    expect(parsed.invoice_number).toBe("X-1");
  });
});

describe("parseLineItems", () => {
  it("returns empty array for non-array input", () => {
    expect(parseLineItems(null)).toEqual([]);
    expect(parseLineItems({})).toEqual([]);
  });

  it("fills missing fields with defaults", () => {
    const items = parseLineItems([{ description: "品目のみ" }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      line_no: 1,
      transaction_date: null,
      description: "品目のみ",
      quantity: "",
      unit: "",
      unit_price: "",
      amount: "",
      tax_rate: "",
    });
  });

  it("interprets reduced tax mark as 8%", () => {
    const items = parseLineItems([{ line_no: 1, description: "軽減", tax_rate: "※" }]);
    expect(items[0].tax_rate).toBe("8");
  });

  it("preserves negative amounts", () => {
    const items = parseLineItems([
      { line_no: 2, description: "出精値引", amount: "-5000" },
    ]);
    expect(items[0].amount).toBe("-5000");
  });
});

describe("normalizeInvoiceNoIssuer", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeInvoiceNoIssuer(" 123 ", "Sample  Co.")).toBe(
      "123|sample co."
    );
  });
});

describe("invoicePlugin.duplicateKeys", () => {
  it("omits key when invoice number is empty", () => {
    expect(
      invoicePlugin.duplicateKeys({ invoice_number: "", issuer_name: "Co" })
    ).toEqual([]);
  });

  it("omits key when issuer is empty", () => {
    expect(
      invoicePlugin.duplicateKeys({ invoice_number: "123", issuer_name: "" })
    ).toEqual([]);
  });
});

describe("parseAmountYen", () => {
  it("strips currency symbols", () => {
    expect(parseAmountYen("¥360,000-")).toBe(360000);
    expect(parseAmountYen("")).toBeNull();
  });

  it("handles yen suffix and spaces", () => {
    expect(parseAmountYen("360,000 円")).toBe(360000);
  });

  it("returns null for non-numeric values", () => {
    expect(parseAmountYen("abc")).toBeNull();
  });
});

describe("registry", () => {
  it("returns invoice plugin by id", () => {
    expect(getDocumentPlugin("invoice")).toBe(invoicePlugin);
  });

  it("still returns business_card plugin", () => {
    expect(getDocumentPlugin("business_card")?.id).toBe("business_card");
  });
});
