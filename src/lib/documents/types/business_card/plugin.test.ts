import { describe, expect, it } from "vitest";
import { businessCardPlugin, mergeExtracted } from "./plugin";

describe("businessCardPlugin.parseExtracted", () => {
  it("fills missing keys with empty string and drops extras", () => {
    const parsed = businessCardPlugin.parseExtracted({
      full_name: "山田太郎",
      extra: "nope",
    });
    expect(parsed.full_name).toBe("山田太郎");
    expect(parsed.email).toBe("");
    expect(parsed).not.toHaveProperty("extra");
  });
});

describe("mergeExtracted", () => {
  it("prefers front and fills empties from back", () => {
    const merged = mergeExtracted(
      { full_name: "山田", company: "", email: "a@example.com" },
      { full_name: "Yamada", company: "例示商事", email: "b@example.com" }
    );
    expect(merged.full_name).toBe("山田");
    expect(merged.company).toBe("例示商事");
    expect(merged.email).toBe("a@example.com");
  });
});

describe("toIndexedFields", () => {
  it("maps name/company/date and null amount", () => {
    const indexed = businessCardPlugin.toIndexedFields(
      { full_name: "山田太郎", company: "例示商事" },
      { notes: "", tags: [], contextDate: "2026-08-28" }
    );
    expect(indexed.title).toBe("山田太郎");
    expect(indexed.counterparty).toBe("例示商事");
    expect(indexed.context_date).toBe("2026-08-28");
    expect(indexed.amount_yen).toBeNull();
  });
});

describe("duplicateKeys", () => {
  it("emits email first then name_company", () => {
    const keys = businessCardPlugin.duplicateKeys({
      full_name: "山田  太郎",
      company: "例示商事",
      email: " A@Example.com ",
    });
    expect(keys[0]).toEqual({ kind: "email", value: "a@example.com" });
    expect(keys[1]).toEqual({ kind: "name_company", value: "山田 太郎|例示商事" });
  });

  it("omits empty keys", () => {
    const keys = businessCardPlugin.duplicateKeys({
      full_name: "",
      company: "例示商事",
      email: "",
    });
    expect(keys).toEqual([]);
  });
});
