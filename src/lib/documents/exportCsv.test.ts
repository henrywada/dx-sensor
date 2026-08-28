import { describe, expect, it } from "vitest";
import { buildInvoiceCsvRows, encodeCsvWithBom } from "./exportCsv";

describe("exportCsv", () => {
  it("outputs header-only row when no line items", () => {
    const rows = buildInvoiceCsvRows([
      {
        id: "doc-1",
        title: "INV-001",
        counterparty: "Acme",
        contextDate: "2024-01-31",
        amountYen: 1000,
        notes: "",
        tags: [],
        extracted: { issue_date: "2024-01-31", recipient_name: "Client" },
        lineItems: [],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe("INV-001");
    expect(rows[0][17]).toBe(""); // 明細行番号 empty
  });

  it("prefixes UTF-8 BOM", () => {
    const buf = encodeCsvWithBom([["a", "b"]]);
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  it("outputs one row per line item sorted by line_no", () => {
    const rows = buildInvoiceCsvRows([
      {
        id: "doc-1",
        title: "INV-001",
        counterparty: "Acme",
        contextDate: "2024-01-31",
        amountYen: 3000,
        notes: "memo",
        tags: ["tag1", "tag2"],
        extracted: {
          issue_date: "2024-01-31",
          recipient_name: "Client",
        },
        lineItems: [
          {
            line_no: 2,
            transaction_date: "2024-01-20",
            description: "B",
            quantity: "1",
            unit: "式",
            unit_price: "1000",
            amount: "1000",
            tax_rate: "10",
          },
          {
            line_no: 1,
            transaction_date: "2024-01-15",
            description: "A",
            quantity: "2",
            unit: "個",
            unit_price: "1000",
            amount: "2000",
            tax_rate: "8",
          },
        ],
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0][17]).toBe("1");
    expect(rows[0][19]).toBe("A");
    expect(rows[1][17]).toBe("2");
    expect(rows[1][19]).toBe("B");
    expect(rows[0][15]).toBe("tag1|tag2");
    expect(rows[0][14]).toBe("memo");
  });

  it("escapes commas, quotes, and newlines in CSV fields", () => {
    const csv = encodeCsvWithBom([
      ["a", "b, c", 'd"e', "f\ng"],
    ]).toString("utf-8");
    expect(csv).toContain('"b, c"');
    expect(csv).toContain('"d""e"');
    expect(csv).toContain('"f\ng"');
  });

  it("produces 25 columns per row", () => {
    const rows = buildInvoiceCsvRows([
      {
        id: "doc-1",
        title: "INV-001",
        counterparty: "Acme",
        contextDate: null,
        amountYen: null,
        notes: "",
        tags: [],
        extracted: {},
        lineItems: [
          {
            line_no: 1,
            transaction_date: null,
            description: "Item",
            quantity: "1",
            unit: "",
            unit_price: "100",
            amount: "100",
            tax_rate: "",
          },
        ],
      },
    ]);
    expect(rows[0]).toHaveLength(25);
  });
});
