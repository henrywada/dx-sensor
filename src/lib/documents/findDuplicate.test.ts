import { describe, expect, it } from "vitest";
import { businessCardPlugin } from "./types/business_card/plugin";
import { findDuplicate } from "./findDuplicate";

type TestRow = {
  id: string;
  company_visible: boolean;
  extracted: Record<string, string>;
  updated_at: string;
};

function rowKeys(row: TestRow) {
  return businessCardPlugin.duplicateKeys(row.extracted);
}

function makeRow(
  overrides: Partial<TestRow> & Pick<TestRow, "id" | "extracted">
): TestRow {
  return {
    company_visible: true,
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("findDuplicate", () => {
  it("prefers email match over name_company when both could match", () => {
    const rows = [
      makeRow({
        id: "by-name",
        extracted: { full_name: "山田太郎", company: "例示商事", email: "" },
        updated_at: "2026-08-02T00:00:00Z",
      }),
      makeRow({
        id: "by-email",
        extracted: {
          full_name: "別名",
          company: "別会社",
          email: "a@example.com",
        },
        updated_at: "2026-08-01T00:00:00Z",
      }),
    ];

    const incomingKeys = businessCardPlugin.duplicateKeys({
      full_name: "山田太郎",
      company: "例示商事",
      email: "a@example.com",
    });

    const match = findDuplicate(rows, incomingKeys, rowKeys, {
      updatedAt: (r) => r.updated_at,
    });

    expect(match?.id).toBe("by-email");
  });

  it("returns the row with the newest updatedAt when multiple rows share a kind", () => {
    const rows = [
      makeRow({
        id: "older",
        extracted: { email: "a@example.com" },
        updated_at: "2026-08-01T00:00:00Z",
      }),
      makeRow({
        id: "newer",
        extracted: { email: "a@example.com" },
        updated_at: "2026-08-03T00:00:00Z",
      }),
    ];

    const incomingKeys = [{ kind: "email", value: "a@example.com" }];

    const match = findDuplicate(rows, incomingKeys, rowKeys, {
      updatedAt: (r) => r.updated_at,
    });

    expect(match?.id).toBe("newer");
  });

  it("excludes rows filtered out by include", () => {
    const rows = [
      makeRow({
        id: "hidden",
        company_visible: false,
        extracted: { email: "a@example.com" },
      }),
      makeRow({
        id: "visible",
        company_visible: true,
        extracted: { email: "b@example.com" },
      }),
    ];

    const incomingKeys = [{ kind: "email", value: "a@example.com" }];

    const match = findDuplicate(rows, incomingKeys, rowKeys, {
      include: (r) => r.company_visible,
      updatedAt: (r) => r.updated_at,
    });

    expect(match).toBeNull();
  });

  it("excludes rows filtered out by exclude", () => {
    const existingId = "existing";
    const rows = [
      makeRow({
        id: existingId,
        extracted: { email: "a@example.com" },
      }),
      makeRow({
        id: "other",
        extracted: { email: "a@example.com" },
        updated_at: "2026-08-02T00:00:00Z",
      }),
    ];

    const incomingKeys = [{ kind: "email", value: "a@example.com" }];

    const match = findDuplicate(rows, incomingKeys, rowKeys, {
      exclude: (r) => r.id === existingId,
      updatedAt: (r) => r.updated_at,
    });

    expect(match?.id).toBe("other");
  });

  it("falls back to name_company when email does not match", () => {
    const rows = [
      makeRow({
        id: "name-match",
        extracted: { full_name: "山田太郎", company: "例示商事", email: "" },
      }),
    ];

    const incomingKeys = businessCardPlugin.duplicateKeys({
      full_name: "山田太郎",
      company: "例示商事",
      email: "unknown@example.com",
    });

    const match = findDuplicate(rows, incomingKeys, rowKeys, {
      updatedAt: (r) => r.updated_at,
    });

    expect(match?.id).toBe("name-match");
  });
});
