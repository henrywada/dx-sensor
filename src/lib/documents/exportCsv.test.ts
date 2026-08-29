import { describe, expect, it } from "vitest";
import {
  buildInvoiceCsvRows,
  buildInvoiceCsvRowsWithHeader,
  buildPurchaseOrderCsvRows,
  buildPurchaseOrderCsvRowsWithHeader,
  buildReceiptExpenseCsvRows,
  buildReceiptExpenseCsvRowsWithHeader,
  buildReceiptQualifiedCsvRows,
  buildReceiptQualifiedCsvRowsWithHeader,
  encodeCsvWithBom,
  INVOICE_CSV_HEADERS,
  PURCHASE_ORDER_CSV_HEADERS,
  RECEIPT_EXPENSE_CSV_HEADERS,
  RECEIPT_QUALIFIED_CSV_HEADERS,
} from "./exportCsv";

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

  it("outputs one row per invoice in summary mode even with line items", () => {
    const rows = buildInvoiceCsvRows(
      [
        {
          id: "doc-1",
          title: "INV-001",
          counterparty: "Acme",
          contextDate: "2024-01-31",
          amountYen: 3000,
          notes: "",
          tags: [],
          extracted: {},
          lineItems: [
            {
              line_no: 1,
              transaction_date: null,
              description: "A",
              quantity: "1",
              unit: "",
              unit_price: "1000",
              amount: "1000",
              tax_rate: "10",
            },
            {
              line_no: 2,
              transaction_date: null,
              description: "B",
              quantity: "1",
              unit: "",
              unit_price: "2000",
              amount: "2000",
              tax_rate: "10",
            },
          ],
        },
      ],
      "summary"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0][17]).toBe("");
    expect(rows[0][19]).toBe("");
  });

  it("outputs one row per line item sorted by line_no in with_line_items mode", () => {
    const rows = buildInvoiceCsvRows(
      [
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
    ],
      "with_line_items"
    );
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

  it("guards formula-injection-prone leading characters with a leading quote", () => {
    const csv = encodeCsvWithBom([
      ["=CMD('/C calc')", "+1+1", "-1+1", "@SUM(A1)", "normal"],
    ]).toString("utf-8");
    expect(csv).toContain("'=CMD('/C calc')");
    expect(csv).toContain("'+1+1");
    expect(csv).toContain("'-1+1");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain(",normal");
    expect(csv).not.toMatch(/(?<!')=CMD/);
  });

  it("outputs column header row as first line", () => {
    const rows = buildInvoiceCsvRowsWithHeader([
      {
        id: "doc-1",
        title: "INV-001",
        counterparty: "Acme",
        contextDate: null,
        amountYen: null,
        notes: "",
        tags: [],
        extracted: {},
        lineItems: [],
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([...INVOICE_CSV_HEADERS]);
    expect(rows[1][1]).toBe("INV-001");
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

describe("purchase order exportCsv", () => {
  it("outputs header-only row when no line items", () => {
    const rows = buildPurchaseOrderCsvRows([
      {
        id: "doc-1",
        title: "PO-001",
        counterparty: "サンプル株式会社",
        contextDate: "2024-01-31",
        amountYen: 1000,
        notes: "",
        tags: [],
        extracted: { issue_date: "2024-01-31", issuer_name: "自社株式会社" },
        lineItems: [],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe("PO-001");
    expect(rows[0][18]).toBe(""); // 明細行番号 empty
  });

  it("maps recipient to 発注先 column and issuer to 発注元 column (reversed from invoice)", () => {
    const rows = buildPurchaseOrderCsvRows([
      {
        id: "doc-1",
        title: "PO-001",
        counterparty: "取引先株式会社",
        contextDate: "2024-01-31",
        amountYen: 1000,
        notes: "",
        tags: [],
        extracted: {
          issuer_name: "自社株式会社",
          delivery_date: "2024-02-15",
          delivery_place: "本社倉庫",
          payment_terms: "月末締め翌月末払い",
        },
        lineItems: [],
      },
    ]);
    expect(rows[0][4]).toBe("取引先株式会社"); // 発注先 = counterparty
    expect(rows[0][5]).toBe("自社株式会社"); // 発注元 = extracted.issuer_name
    expect(rows[0][3]).toBe("2024-02-15"); // 納期
    expect(rows[0][7]).toBe("本社倉庫"); // 納品場所
    expect(rows[0][8]).toBe("月末締め翌月末払い"); // 支払条件
  });

  it("outputs one row per line item sorted by line_no in with_line_items mode", () => {
    const rows = buildPurchaseOrderCsvRows(
      [
        {
          id: "doc-1",
          title: "PO-001",
          counterparty: "取引先株式会社",
          contextDate: "2024-01-31",
          amountYen: 3000,
          notes: "memo",
          tags: ["tag1", "tag2"],
          extracted: {},
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
      ],
      "with_line_items"
    );
    expect(rows).toHaveLength(2);
    expect(rows[0][18]).toBe("1");
    expect(rows[0][20]).toBe("A");
    expect(rows[1][18]).toBe("2");
    expect(rows[1][20]).toBe("B");
  });

  it("outputs column header row as first line", () => {
    const rows = buildPurchaseOrderCsvRowsWithHeader([
      {
        id: "doc-1",
        title: "PO-001",
        counterparty: "取引先株式会社",
        contextDate: null,
        amountYen: null,
        notes: "",
        tags: [],
        extracted: {},
        lineItems: [],
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([...PURCHASE_ORDER_CSV_HEADERS]);
    expect(rows[1][1]).toBe("PO-001");
  });

  it("produces 26 columns per row", () => {
    const rows = buildPurchaseOrderCsvRows([
      {
        id: "doc-1",
        title: "PO-001",
        counterparty: "取引先株式会社",
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
    expect(rows[0]).toHaveLength(26);
  });
});

describe("receipt expense exportCsv", () => {
  it("outputs exactly one row per document", () => {
    const rows = buildReceiptExpenseCsvRows([
      {
        id: "doc-1",
        title: "打合せ",
        counterparty: "サンプル商店",
        contextDate: "2026-08-01",
        amountYen: 1200,
        notes: "memo",
        tags: ["tag1"],
        extracted: {
          transaction_date: "2026-08-01",
          amount: "1200",
          payment_method: "現金",
          expense_category: "会議費",
          issuer_name: "サンプル商店",
          purpose: "打合せ",
          participants: "山田,佐藤",
          participant_count: "2",
          department_code: "PJ-001",
          applicant: "山田",
          approver: "佐藤",
        },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("doc-1");
  });

  it("outputs the RECEIPT_EXPENSE_CSV_HEADERS as the first row", () => {
    const rows = buildReceiptExpenseCsvRowsWithHeader([
      {
        id: "doc-1",
        title: "打合せ",
        counterparty: "サンプル商店",
        contextDate: null,
        amountYen: null,
        notes: "",
        tags: [],
        extracted: {},
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([...RECEIPT_EXPENSE_CSV_HEADERS]);
  });

  it("escapes formula-injection-prone leading characters", () => {
    const rows = buildReceiptExpenseCsvRows([
      {
        id: "doc-1",
        title: "打合せ",
        counterparty: "",
        contextDate: null,
        amountYen: null,
        notes: "",
        tags: [],
        extracted: { issuer_name: "=CMD()" },
      },
    ]);
    const csv = encodeCsvWithBom(rows).toString("utf-8");
    expect(csv).toContain("'=CMD()");
  });
});

describe("receipt qualified_invoice exportCsv", () => {
  it("outputs the 8%/10% breakdown as individual columns", () => {
    const rows = buildReceiptQualifiedCsvRows([
      {
        id: "doc-1",
        title: "T1234567890123",
        counterparty: "サンプル株式会社",
        contextDate: "2026-08-01",
        amountYen: 56080,
        notes: "",
        tags: [],
        extracted: {
          issuer_name: "サンプル株式会社",
          registration_number: "T1234567890123",
          transaction_date: "2026-08-01",
          transaction_details: "雑貨代",
          subtotal_10: "50000",
          tax_10: "5000",
          subtotal_8: "1000",
          tax_8: "80",
          total: "56080",
          recipient_name: "〇〇 〇〇",
        },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      "doc-1",
      "サンプル株式会社",
      "T1234567890123",
      "2026-08-01",
      "雑貨代",
      "50000",
      "5000",
      "1000",
      "80",
      "56080",
      "〇〇 〇〇",
      "",
      "",
    ]);
  });

  it("outputs the RECEIPT_QUALIFIED_CSV_HEADERS as the first row", () => {
    const rows = buildReceiptQualifiedCsvRowsWithHeader([
      {
        id: "doc-1",
        title: "T1234567890123",
        counterparty: "サンプル株式会社",
        contextDate: null,
        amountYen: null,
        notes: "",
        tags: [],
        extracted: {},
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([...RECEIPT_QUALIFIED_CSV_HEADERS]);
  });
});
