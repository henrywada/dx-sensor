import { describe, expect, it } from "vitest";
import {
  RECEIPT_EXPENSE_HEADER_KEYS,
  RECEIPT_QUALIFIED_HEADER_KEYS,
  receiptExpenseMode,
  receiptPlugin,
  receiptQualifiedMode,
} from "./plugin";

describe("receiptExpenseMode.parseExtracted", () => {
  it("whitelists known keys and fills missing ones with empty string", () => {
    const parsed = receiptExpenseMode.parseExtracted({
      header: { transaction_date: "2026-08-01", issuer_name: "サンプル商店" },
    });
    expect(parsed.transaction_date).toBe("2026-08-01");
    expect(parsed.issuer_name).toBe("サンプル商店");
    expect(parsed.amount).toBe("");
    expect(Object.keys(parsed)).toHaveLength(RECEIPT_EXPENSE_HEADER_KEYS.length);
  });

  it("ignores unknown keys and manual-input keys not present in AI response", () => {
    const parsed = receiptExpenseMode.parseExtracted({
      header: { transaction_date: "2026-08-01", bogus_key: "x" },
    });
    expect(parsed).not.toHaveProperty("bogus_key");
    expect(parsed.purpose).toBe("");
  });

  it("returns an all-empty header for invalid input", () => {
    const parsed = receiptExpenseMode.parseExtracted(null);
    expect(parsed.transaction_date).toBe("");
    expect(Object.keys(parsed)).toHaveLength(RECEIPT_EXPENSE_HEADER_KEYS.length);
  });
});

describe("receiptExpenseMode.toIndexedFields", () => {
  it("prefers purpose for title, falls back to issuer_name", () => {
    const withPurpose = receiptExpenseMode.toIndexedFields(
      { purpose: "打合せ", issuer_name: "サンプル商店", amount: "1,200" },
      { notes: "", tags: [], contextDate: "2026-08-01" }
    );
    expect(withPurpose.title).toBe("打合せ");

    const withoutPurpose = receiptExpenseMode.toIndexedFields(
      { purpose: "", issuer_name: "サンプル商店", amount: "1,200" },
      { notes: "", tags: [], contextDate: "2026-08-01" }
    );
    expect(withoutPurpose.title).toBe("サンプル商店");
  });

  it("maps amount to amount_yen and issuer_name to counterparty", () => {
    const indexed = receiptExpenseMode.toIndexedFields(
      { issuer_name: "サンプル商店", amount: "¥1,200" },
      { notes: "", tags: [], contextDate: "2026-08-01" }
    );
    expect(indexed.counterparty).toBe("サンプル商店");
    expect(indexed.amount_yen).toBe(1200);
    expect(indexed.context_date).toBe("2026-08-01");
  });

  it("returns null amount_yen when amount is unparseable", () => {
    const indexed = receiptExpenseMode.toIndexedFields(
      { amount: "invalid" },
      { notes: "", tags: [], contextDate: null }
    );
    expect(indexed.amount_yen).toBeNull();
  });
});

describe("receiptExpenseMode.duplicateKeys", () => {
  it("returns a key when date, amount, and issuer are all present", () => {
    const keys = receiptExpenseMode.duplicateKeys({
      transaction_date: "2026-08-01",
      amount: "1200",
      issuer_name: " Sample Shop ",
    });
    expect(keys).toHaveLength(1);
    expect(keys[0].kind).toBe("receipt_expense_key");
    expect(keys[0].value).toContain("2026-08-01");
    expect(keys[0].value).toContain("1200");
    expect(keys[0].value).toContain("sample shop");
  });

  it("omits key when any required field is missing", () => {
    expect(
      receiptExpenseMode.duplicateKeys({ transaction_date: "", amount: "1200", issuer_name: "Co" })
    ).toEqual([]);
    expect(
      receiptExpenseMode.duplicateKeys({ transaction_date: "2026-08-01", amount: "", issuer_name: "Co" })
    ).toEqual([]);
    expect(
      receiptExpenseMode.duplicateKeys({ transaction_date: "2026-08-01", amount: "1200", issuer_name: "" })
    ).toEqual([]);
  });
});

describe("receiptQualifiedMode.parseExtracted", () => {
  it("whitelists known keys and fills missing ones with empty string", () => {
    const parsed = receiptQualifiedMode.parseExtracted({
      header: { registration_number: "T1234567890123", issuer_name: "サンプル株式会社" },
    });
    expect(parsed.registration_number).toBe("T1234567890123");
    expect(parsed.issuer_name).toBe("サンプル株式会社");
    expect(parsed.subtotal_10).toBe("");
    expect(Object.keys(parsed)).toHaveLength(RECEIPT_QUALIFIED_HEADER_KEYS.length);
  });
});

describe("receiptQualifiedMode.toIndexedFields", () => {
  it("prefers registration_number for title, falls back to issuer_name", () => {
    const withReg = receiptQualifiedMode.toIndexedFields(
      { registration_number: "T1234567890123", issuer_name: "サンプル株式会社", total: "1200" },
      { notes: "", tags: [], contextDate: "2026-08-01" }
    );
    expect(withReg.title).toBe("T1234567890123");

    const withoutReg = receiptQualifiedMode.toIndexedFields(
      { registration_number: "", issuer_name: "サンプル株式会社", total: "1200" },
      { notes: "", tags: [], contextDate: "2026-08-01" }
    );
    expect(withoutReg.title).toBe("サンプル株式会社");
  });

  it("maps total to amount_yen", () => {
    const indexed = receiptQualifiedMode.toIndexedFields(
      { total: "¥1,200-" },
      { notes: "", tags: [], contextDate: null }
    );
    expect(indexed.amount_yen).toBe(1200);
  });
});

describe("receiptQualifiedMode.duplicateKeys", () => {
  it("returns a key when registration_number and transaction_date are present", () => {
    const keys = receiptQualifiedMode.duplicateKeys({
      registration_number: " T1234567890123 ",
      transaction_date: "2026-08-01",
    });
    expect(keys).toHaveLength(1);
    expect(keys[0].kind).toBe("receipt_qualified_key");
    expect(keys[0].value).toContain("t1234567890123");
    expect(keys[0].value).toContain("2026-08-01");
  });

  it("omits key when registration_number or transaction_date is missing", () => {
    expect(
      receiptQualifiedMode.duplicateKeys({ registration_number: "", transaction_date: "2026-08-01" })
    ).toEqual([]);
    expect(
      receiptQualifiedMode.duplicateKeys({ registration_number: "T1234567890123", transaction_date: "" })
    ).toEqual([]);
  });
});

describe("receiptPlugin", () => {
  it("has exactly the expense and qualified_invoice modes", () => {
    expect(receiptPlugin.modes).toHaveLength(2);
    expect(receiptPlugin.modes?.map((m) => m.id)).toEqual([
      "expense",
      "qualified_invoice",
    ]);
  });

  it("allows exactly one page image", () => {
    expect(receiptPlugin.imagePolicy).toEqual({
      min: 1,
      max: 1,
      allowedRoles: ["page"],
    });
  });

  it("does not support line items but exposes a safe empty parser", () => {
    expect(receiptPlugin.supportsLineItems).toBe(false);
    expect(receiptPlugin.structuredOcr).toBe(true);
    expect(receiptPlugin.parseLineItems?.(["anything"])).toEqual([]);
  });
});
