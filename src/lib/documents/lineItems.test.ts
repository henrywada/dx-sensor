import { describe, expect, it } from "vitest";
import {
  lineItemDraftToDbRow,
  normalizeLineItemDraft,
  parseNumericOrNull,
} from "./lineItems";

describe("lineItems", () => {
  describe("parseNumericOrNull", () => {
    it("parses plain numbers", () => {
      expect(parseNumericOrNull("20000")).toBe(20000);
    });

    it("strips currency symbols and commas", () => {
      expect(parseNumericOrNull("¥20,000")).toBe(20000);
      expect(parseNumericOrNull("20000円")).toBe(20000);
    });

    it("returns null for empty or invalid", () => {
      expect(parseNumericOrNull("")).toBeNull();
      expect(parseNumericOrNull("abc")).toBeNull();
    });
  });

  describe("normalizeLineItemDraft", () => {
    it("trims fields and normalizes tax rate markers", () => {
      const result = normalizeLineItemDraft({
        line_no: 1,
        transaction_date: "",
        description: "  item  ",
        quantity: "1",
        unit: "個",
        unit_price: "1000",
        amount: "1000",
        tax_rate: "※",
      });
      expect(result.description).toBe("item");
      expect(result.tax_rate).toBe("8");
      expect(result.transaction_date).toBeNull();
    });
  });

  describe("lineItemDraftToDbRow", () => {
    it("maps draft to DB row with parsed numerics", () => {
      const row = lineItemDraftToDbRow(
        {
          line_no: 1,
          transaction_date: "2024-01-15",
          description: "Sample",
          quantity: "2",
          unit: "個",
          unit_price: "10,000",
          amount: "20,000",
          tax_rate: "10",
        },
        "doc-id",
        "tenant-id"
      );
      expect(row.document_id).toBe("doc-id");
      expect(row.tenant_id).toBe("tenant-id");
      expect(row.line_no).toBe(1);
      expect(row.transaction_date).toBe("2024-01-15");
      expect(row.unit_price).toBe(10000);
      expect(row.amount).toBe(20000);
    });

    it("parses slash-separated transaction dates", () => {
      const row = lineItemDraftToDbRow(
        {
          line_no: 1,
          transaction_date: "2024/01/15",
          description: "Sample",
          quantity: "1",
          unit: "",
          unit_price: "",
          amount: "",
          tax_rate: "",
        },
        "doc-id",
        "tenant-id"
      );
      expect(row.transaction_date).toBe("2024-01-15");
    });

    it("stores null for unparseable numerics and dates", () => {
      const row = lineItemDraftToDbRow(
        {
          line_no: 2,
          transaction_date: "invalid",
          description: "",
          quantity: "",
          unit: "",
          unit_price: "n/a",
          amount: "",
          tax_rate: "",
        },
        "doc-id",
        "tenant-id"
      );
      expect(row.transaction_date).toBeNull();
      expect(row.unit_price).toBeNull();
      expect(row.amount).toBeNull();
    });
  });
});
