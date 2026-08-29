import { describe, expect, it } from "vitest";
import { getDocumentPlugin } from "../../registry";
import {
  PURCHASE_ORDER_HEADER_KEYS,
  normalizeOrderNoRecipient,
  parseAmountYen,
  parseLineItems,
  parsePurchaseOrderHeader,
  purchaseOrderPlugin,
} from "./plugin";

describe("purchaseOrderPlugin", () => {
  it("maps header to indexed fields using recipient as counterparty", () => {
    const extracted = Object.fromEntries(
      PURCHASE_ORDER_HEADER_KEYS.map((k) => [k, ""])
    ) as Record<string, string>;
    extracted.order_number = "PO-20240131-001";
    extracted.recipient_name = "サンプル株式会社";
    extracted.issuer_name = "自社株式会社";
    extracted.total = "360,000";
    const indexed = purchaseOrderPlugin.toIndexedFields(extracted, {
      notes: "",
      tags: [],
      contextDate: "2024-01-31",
    });
    expect(indexed.title).toBe("PO-20240131-001");
    expect(indexed.counterparty).toBe("サンプル株式会社");
    expect(indexed.counterparty).not.toBe("自社株式会社");
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

  it("builds duplicate key from order number and recipient", () => {
    const keys = purchaseOrderPlugin.duplicateKeys({
      order_number: " 123 ",
      recipient_name: "Sample Co.",
    });
    expect(keys[0].kind).toBe("order_no_recipient");
    expect(keys[0].value).toContain("123");
    expect(keys[0].value).toContain("sample co.");
  });

  it("exposes line item and structured OCR flags", () => {
    expect(purchaseOrderPlugin.supportsLineItems).toBe(true);
    expect(purchaseOrderPlugin.structuredOcr).toBe(true);
    expect(purchaseOrderPlugin.parseLineItems).toBe(parseLineItems);
  });

  it("allows 1-10 page images only", () => {
    expect(purchaseOrderPlugin.imagePolicy).toEqual({
      min: 1,
      max: 10,
      allowedRoles: ["page"],
    });
  });

  it("uses user contextDate for indexed context_date", () => {
    const extracted = Object.fromEntries(
      PURCHASE_ORDER_HEADER_KEYS.map((k) => [k, ""])
    ) as Record<string, string>;
    extracted.issue_date = "2024-01-31";
    const indexed = purchaseOrderPlugin.toIndexedFields(extracted, {
      notes: "",
      tags: [],
      contextDate: null,
    });
    expect(indexed.context_date).toBeNull();
  });

  it("returns null amount_yen when total is unparseable", () => {
    const extracted = Object.fromEntries(
      PURCHASE_ORDER_HEADER_KEYS.map((k) => [k, ""])
    ) as Record<string, string>;
    extracted.total = "invalid";
    const indexed = purchaseOrderPlugin.toIndexedFields(extracted, {
      notes: "",
      tags: [],
      contextDate: null,
    });
    expect(indexed.amount_yen).toBeNull();
  });

  it("includes every header key in the analyze prompt", () => {
    for (const key of PURCHASE_ORDER_HEADER_KEYS) {
      expect(purchaseOrderPlugin.analyzePrompt).toContain(key);
    }
    expect(purchaseOrderPlugin.analyzePrompt).not.toContain("invoice_number");
    expect(purchaseOrderPlugin.analyzePrompt).not.toContain("bank_info");
    expect(purchaseOrderPlugin.analyzePrompt).not.toContain("請求書");
  });
});

describe("parsePurchaseOrderHeader", () => {
  it("parses from structured header object", () => {
    const parsed = parsePurchaseOrderHeader({
      header: {
        order_number: "PO-001",
        recipient_name: "テスト株式会社",
      },
    });
    expect(parsed.order_number).toBe("PO-001");
    expect(parsed.recipient_name).toBe("テスト株式会社");
    expect(parsed.issuer_name).toBe("");
  });

  it("parses from flat object", () => {
    const parsed = parsePurchaseOrderHeader({
      order_number: "PO-002",
      total: "1000",
      extra: "ignored",
    });
    expect(parsed.order_number).toBe("PO-002");
    expect(parsed.total).toBe("1000");
    expect(parsed).not.toHaveProperty("extra");
  });

  it("returns empty header for invalid input", () => {
    const parsed = parsePurchaseOrderHeader(null);
    expect(parsed.order_number).toBe("");
    expect(Object.keys(parsed)).toHaveLength(PURCHASE_ORDER_HEADER_KEYS.length);
  });

  it("reads purchase-order-specific fields", () => {
    const parsed = parsePurchaseOrderHeader({
      delivery_date: "2024-02-15",
      delivery_place: "本社倉庫",
      payment_terms: "月末締め翌月末払い",
    });
    expect(parsed.delivery_date).toBe("2024-02-15");
    expect(parsed.delivery_place).toBe("本社倉庫");
    expect(parsed.payment_terms).toBe("月末締め翌月末払い");
  });

  it("does not carry over invoice-only fields", () => {
    expect(PURCHASE_ORDER_HEADER_KEYS).not.toContain("due_date");
    expect(PURCHASE_ORDER_HEADER_KEYS).not.toContain("bank_info");
  });
});

describe("purchaseOrderPlugin.parseExtracted", () => {
  it("delegates to parsePurchaseOrderHeader", () => {
    const parsed = purchaseOrderPlugin.parseExtracted({
      header: { order_number: "X-1" },
    });
    expect(parsed.order_number).toBe("X-1");
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
      { line_no: 2, description: "値引", amount: "-5000" },
    ]);
    expect(items[0].amount).toBe("-5000");
  });
});

describe("normalizeOrderNoRecipient", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeOrderNoRecipient(" 123 ", "Sample  Co.")).toBe(
      "123|sample co."
    );
  });
});

describe("purchaseOrderPlugin.duplicateKeys", () => {
  it("omits key when order number is empty", () => {
    expect(
      purchaseOrderPlugin.duplicateKeys({ order_number: "", recipient_name: "Co" })
    ).toEqual([]);
  });

  it("omits key when recipient is empty", () => {
    expect(
      purchaseOrderPlugin.duplicateKeys({ order_number: "123", recipient_name: "" })
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
  it("returns purchase_order plugin by id", () => {
    expect(getDocumentPlugin("purchase_order")).toBe(purchaseOrderPlugin);
  });

  it("still returns invoice and business_card plugins", () => {
    expect(getDocumentPlugin("invoice")?.id).toBe("invoice");
    expect(getDocumentPlugin("business_card")?.id).toBe("business_card");
  });
});
